// Cloudflare Worker: receives JPEG snapshots from two cameras
//   - "ammersricht": ESP32-CAM (see ../esp32), uploads every ~60s
//   - "weiden":      Raspberry Pi + camera module, uploads every ~60s
// Stores the latest snapshot per camera in R2, keeps an hourly rollup
// archive per camera, and serves small HTML pages for both.
//
// R2 key layout:
//   latest.jpg                         - ammersricht live image (legacy,
//                                         unprefixed key kept for backwards
//                                         compatibility with data already
//                                         in the bucket)
//   archive/YYYY-MM-DD/HH.jpg          - ammersricht hourly archive
//   weiden/latest.jpg                  - weiden live image
//   weiden/archive/YYYY-MM-DD/HH.jpg   - weiden hourly archive
//
// Dates/hours are computed in Europe/Berlin local time. The hourly archive
// is written by the scheduled (cron) handler, which runs at the top of
// every hour and copies each camera's current latest.jpg into that hour's
// archive slot. The cron schedule lives in wrangler.toml ([triggers]).
//
// Routes (":cam" is "ammersricht" or "weiden"; "ammersricht" is also
// reachable unprefixed for backwards compatibility with the already
// deployed ESP32-CAM firmware and the main website):
//   GET  /                        - HTML page, alias for /ammersricht (?cam= also works)
//   GET  /image                   - alias for /ammersricht/image
//   POST /upload                  - alias for /ammersricht/upload
//   GET  /archive[...]            - alias for /ammersricht/archive[...]
//   GET  /:cam                    - HTML page for one camera
//   GET  /:cam/image              - latest JPEG for a camera
//   POST /:cam/upload             - store a new JPEG (Authorization: Bearer <token>)
//   GET  /:cam/archive            - list of archived dates (newest first)
//   GET  /:cam/archive/:date      - hour grid for one day (YYYY-MM-DD)
//   GET  /:cam/archive/:date/:hh.jpg - one hourly snapshot

const CAMERAS = {
  ammersricht: {
    label: "Ammersricht",
    latestKey: "latest.jpg",
    archivePrefix: "archive/",
    tokenEnvVar: "UPLOAD_TOKEN",
  },
  weiden: {
    label: "Weiden",
    latestKey: "weiden/latest.jpg",
    archivePrefix: "weiden/archive/",
    tokenEnvVar: "UPLOAD_TOKEN_WEIDEN",
  },
};

const DEFAULT_CAM = "ammersricht";
const REFRESH_SECONDS = 30;
const TIMEZONE = "Europe/Berlin";
const MAX_ARCHIVE_DATES = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_FILE_RE = /^\d{2}\.jpg$/;

function localDateAndHour(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = parts.hour;
  if (hour === "24") hour = "00"; // some ICU versions emit "24" for midnight
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour };
}

function switcherHtml(activeCam) {
  return Object.entries(CAMERAS)
    .map(([id, cfg]) => {
      const href = id === DEFAULT_CAM ? "/" : `/${id}`;
      const cls = id === activeCam ? "cam-link active" : "cam-link";
      return `<a class="${cls}" href="${href}">${cfg.label}</a>`;
    })
    .join("");
}

function pageHtml(cam) {
  const label = CAMERAS[cam].label;
  const imagePath = cam === DEFAULT_CAM ? "/image" : `/${cam}/image`;
  const archivePath = cam === DEFAULT_CAM ? "/archive" : `/${cam}/archive`;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Webcam ${label}</title>
<style>
  html, body {
    margin: 0; min-height: 100%; background: #111; color: #eee;
    font-family: system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 1rem 0;
  }
  h1 { font-size: 1rem; font-weight: 400; opacity: 0.7; margin: 0.5rem; }
  img { max-width: 95vw; max-height: 80vh; border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
  #ts { font-size: 0.8rem; opacity: 0.5; margin-top: 0.5rem; }
  .switch { margin-bottom: 0.5rem; }
  .cam-link {
    color: #eee; opacity: 0.6; text-decoration: none; margin: 0 0.5rem;
    padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid #444;
  }
  .cam-link.active { opacity: 1; border-color: #6cf; color: #6cf; }
  .archive-link { margin-top: 0.75rem; color: #6cf; font-size: 0.85rem; text-decoration: none; }
</style>
</head>
<body>
  <div class="switch">${switcherHtml(cam)}</div>
  <h1>Live-Webcam ${label}</h1>
  <img id="cam" src="${imagePath}" alt="Webcam Bild ${label}">
  <div id="ts"></div>
  <a class="archive-link" href="${archivePath}">Archiv (stundliche Bilder)</a>
  <script>
    const img = document.getElementById('cam');
    const ts = document.getElementById('ts');
    const base = ${JSON.stringify(imagePath)};
    function refresh() {
      img.src = base + '?t=' + Date.now();
      ts.textContent = 'Letzte Aktualisierung: ' + new Date().toLocaleTimeString('de-DE');
    }
    refresh();
    setInterval(refresh, ${REFRESH_SECONDS * 1000});
  </script>
</body>
</html>`;
}

function archiveIndexHtml(cam, dates) {
  const label = CAMERAS[cam].label;
  const backHref = cam === DEFAULT_CAM ? "/" : `/${cam}`;
  const camPrefix = cam === DEFAULT_CAM ? "/archive" : `/${cam}/archive`;
  const items = dates.map((d) => `<li><a href="${camPrefix}/${d}">${d}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archiv ${label}</title>
<style>
  body { margin: 0; padding: 1.5rem; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  a { color: #6cf; }
  .back { display: inline-block; margin-bottom: 1rem; text-decoration: none; }
  .switch { margin-bottom: 1rem; }
  .cam-link {
    color: #eee; opacity: 0.6; text-decoration: none; margin-right: 0.5rem;
    padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid #444;
  }
  .cam-link.active { opacity: 1; border-color: #6cf; color: #6cf; }
  ul { list-style: none; padding: 0; }
  li { margin: 0.4rem 0; }
</style>
</head>
<body>
  <div class="switch">${switcherHtml(cam)}</div>
  <a class="back" href="${backHref}">&larr; Live-Webcam ${label}</a>
  <h1>Archiv ${label}</h1>
  <ul>
${items || "<li>Noch keine Archivbilder.</li>"}
  </ul>
</body>
</html>`;
}

function archiveDayHtml(cam, date, hours) {
  const label = CAMERAS[cam].label;
  const camArchive = cam === DEFAULT_CAM ? "/archive" : `/${cam}/archive`;
  const figures = hours
    .map((h) => `
  <a href="${camArchive}/${date}/${h}.jpg">
    <figure>
      <img src="${camArchive}/${date}/${h}.jpg" alt="${h} Uhr" loading="lazy">
      <figcaption>${h}:00</figcaption>
    </figure>
  </a>`)
    .join("");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archiv ${label} ${date}</title>
<style>
  body { margin: 0; padding: 1.5rem; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  a { color: #6cf; }
  .back { display: inline-block; margin-bottom: 1rem; text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
  figure { margin: 0; }
  img { width: 100%; border-radius: 6px; display: block; }
  figcaption { text-align: center; font-size: 0.8rem; opacity: 0.7; margin-top: 0.25rem; }
</style>
</head>
<body>
  <a class="back" href="${camArchive}">&larr; Archiv-Ubersicht ${label}</a>
  <h1>${label} ${date}</h1>
  <div class="grid">${figures}</div>
</body>
</html>`;
}

async function listArchiveDates(bucket, prefix) {
  const result = await bucket.list({ prefix, delimiter: "/" });
  const dates = (result.delimitedPrefixes || [])
    .map((p) => p.slice(prefix.length, -1))
    .filter((d) => DATE_RE.test(d))
    .sort()
    .reverse()
    .slice(0, MAX_ARCHIVE_DATES);
  return dates;
}

async function listArchiveHours(bucket, prefix, date) {
  const dayPrefix = `${prefix}${date}/`;
  const result = await bucket.list({ prefix: dayPrefix });
  const hours = (result.objects || [])
    .map((o) => o.key.slice(dayPrefix.length))
    .filter((k) => HOUR_FILE_RE.test(k))
    .map((k) => k.slice(0, 2))
    .sort();
  return hours;
}

async function handleImage(env, camConfig) {
  const object = await env.WEBCAM_BUCKET.get(camConfig.latestKey);
  if (!object) {
    return new Response("no image yet", { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
    },
  });
}

async function handleUpload(request, env, camConfig) {
  const expectedToken = env[camConfig.tokenEnvVar];
  const auth = request.headers.get("authorization") || "";
  if (!expectedToken || auth !== `Bearer ${expectedToken}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return new Response("empty body", { status: 400 });
  }

  await env.WEBCAM_BUCKET.put(camConfig.latestKey, body, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  return new Response("ok");
}

// Cron handler: copy each camera's current snapshot into the hourly
// archive. Runs at the top of every hour (see [triggers] in wrangler.toml).
async function archiveAllCameras(env, now) {
  const { date, hour } = localDateAndHour(now, TIMEZONE);

  for (const camConfig of Object.values(CAMERAS)) {
    const latest = await env.WEBCAM_BUCKET.get(camConfig.latestKey);
    if (!latest) {
      // Camera has never uploaded (or bucket was cleared) - nothing to archive.
      continue;
    }
    const archiveKey = `${camConfig.archivePrefix}${date}/${hour}.jpg`;
    await env.WEBCAM_BUCKET.put(archiveKey, latest.body, {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }
}

async function handleArchiveIndex(env, cam, camConfig) {
  const dates = await listArchiveDates(env.WEBCAM_BUCKET, camConfig.archivePrefix);
  return new Response(archiveIndexHtml(cam, dates), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handleArchiveDay(env, cam, camConfig, date) {
  if (!DATE_RE.test(date)) {
    return new Response("not found", { status: 404 });
  }
  const hours = await listArchiveHours(env.WEBCAM_BUCKET, camConfig.archivePrefix, date);
  return new Response(archiveDayHtml(cam, date, hours), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handleArchiveHour(env, camConfig, date, hourFile) {
  if (!DATE_RE.test(date) || !HOUR_FILE_RE.test(hourFile)) {
    return new Response("not found", { status: 404 });
  }
  const key = `${camConfig.archivePrefix}${date}/${hourFile}`;
  const object = await env.WEBCAM_BUCKET.get(key);
  if (!object) {
    return new Response("not found", { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    let cam = DEFAULT_CAM;
    let rest = parts;
    if (parts.length > 0 && Object.prototype.hasOwnProperty.call(CAMERAS, parts[0])) {
      cam = parts[0];
      rest = parts.slice(1);
    } else {
      const queryCam = url.searchParams.get("cam");
      if (queryCam && Object.prototype.hasOwnProperty.call(CAMERAS, queryCam)) {
        cam = queryCam;
      }
    }
    const camConfig = CAMERAS[cam];

    if (request.method === "GET" && rest.length === 0) {
      return new Response(pageHtml(cam), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (request.method === "GET" && rest.length === 1 && rest[0] === "image") {
      return handleImage(env, camConfig);
    }

    if (request.method === "POST" && rest.length === 1 && rest[0] === "upload") {
      return handleUpload(request, env, camConfig);
    }

    if (rest[0] === "archive") {
      if (request.method === "GET" && rest.length === 1) {
        return handleArchiveIndex(env, cam, camConfig);
      }
      if (request.method === "GET" && rest.length === 2) {
        return handleArchiveDay(env, cam, camConfig, rest[1]);
      }
      if (request.method === "GET" && rest.length === 3) {
        return handleArchiveHour(env, camConfig, rest[1], rest[2]);
      }
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(archiveAllCameras(env, new Date(event.scheduledTime)));
  },
};
