// Cloudflare Worker: receives JPEG snapshots from two cameras
//   - "ammersricht": ESP32-CAM (see ../esp32), uploads every ~60s
//   - "weiden":      Raspberry Pi + camera module, uploads every ~60s
// Stores the latest snapshot per camera in R2, keeps an hourly rollup
// archive per camera, and serves small HTML pages for both.
//
// R2 bucket "weather-webcam", key layout:
//   latest_ammersricht.jpg                    - ammersricht live image
//   latest_weiden.jpg                         - weiden live image
//   archive_ammersricht/YYYY-MM-DD/HH.jpg     - ammersricht hourly archive
//   archive_weiden/YYYY-MM-DD/HH.jpg          - weiden hourly archive
//
// Dates/hours are computed in Europe/Berlin local time. The hourly archive
// is written by the scheduled (cron) handler, which runs at the top of
// every hour and copies each camera's current live image into that hour's
// archive slot. The cron schedule lives in wrangler.toml ([triggers]).
//
// Routes are symmetric - every camera is addressed the same way, there are
// no unprefixed legacy routes ("<cam>" is "ammersricht" or "weiden"):
//   GET  /                              - redirect to the default camera
//   GET  /<cam>                         - HTML page, auto-refreshing <img>
//   GET  /<cam>/image                   - latest JPEG bytes
//   POST /<cam>/upload                  - store a new JPEG (Authorization: Bearer <token>)
//   GET  /<cam>/archive                 - list of archived dates (newest first)
//   GET  /<cam>/archive/YYYY-MM-DD      - hour grid for one day
//   GET  /<cam>/archive/YYYY-MM-DD/HH.jpg - one archived JPEG

const CAMERAS = {
  ammersricht: {
    label: "Ammersricht",
    latestKey: "latest_ammersricht.jpg",
    archivePrefix: "archive_ammersricht/",
    tokenEnvVar: "UPLOAD_TOKEN",
  },
  weiden: {
    label: "Weiden",
    latestKey: "latest_weiden.jpg",
    archivePrefix: "archive_weiden/",
    tokenEnvVar: "UPLOAD_TOKEN_WEIDEN",
  },
};

const DEFAULT_CAM = "ammersricht";
const REFRESH_SECONDS = 30;
const TIMEZONE = "Europe/Berlin";
const MAX_ARCHIVE_DATES = 90;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_FILE_RE = /^\d{2}\.jpg$/;

// If a camera has been silent longer than this when the hourly cron fires,
// skip archiving it instead of storing a stale duplicate of the last frame
// it managed to upload.
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// Europe/Berlin calendar date + hour for a given instant, independent of
// the server's own timezone (Workers run in UTC).
function localDateAndHour(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
}

// Camera switcher. `section` keeps the visitor in the same section when
// switching cameras: from an archive page you land on the other camera's
// archive, not on its live page.
function switcherHtml(activeCam, section = "live") {
  return Object.entries(CAMERAS)
    .map(([id, cfg]) => {
      const href = section === "archive" ? `/${id}/archive` : `/${id}`;
      const cls = id === activeCam ? "cam-link active" : "cam-link";
      return `<a class="${cls}" href="${href}">${cfg.label}</a>`;
    })
    .join("");
}

const SHARED_CSS = `
  body { margin: 0; padding: 1.5rem; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  a { color: #6cf; }
  .back { display: inline-block; margin-bottom: 1rem; text-decoration: none; }
  .switch { margin-bottom: 1rem; }
  .cam-link {
    color: #eee; opacity: 0.6; text-decoration: none; margin-right: 0.5rem;
    padding: 0.3rem 0.7rem; border-radius: 999px; border: 1px solid #444;
  }
  .cam-link.active { opacity: 1; border-color: #6cf; color: #6cf; }`;

function pageHtml(cam) {
  const label = CAMERAS[cam].label;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Webcam ${label}</title>
<style>${SHARED_CSS}
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; box-sizing: border-box; }
  h1 { font-size: 1rem; font-weight: 400; opacity: 0.7; margin: 0.5rem; }
  img { max-width: 95vw; max-height: 75vh; border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
  #ts { font-size: 0.8rem; opacity: 0.5; margin-top: 0.5rem; }
  .archive-link { margin-top: 0.75rem; font-size: 0.85rem; text-decoration: none; }
</style>
</head>
<body>
  <div class="switch">${switcherHtml(cam, "live")}</div>
  <h1>Live-Webcam ${label}</h1>
  <img id="cam" src="/${cam}/image" alt="Webcam Bild ${label}">
  <div id="ts"></div>
  <a class="archive-link" href="/${cam}/archive">Archiv (stundliche Bilder)</a>
  <script>
    const img = document.getElementById('cam');
    const ts = document.getElementById('ts');
    function refresh() {
      img.src = '/${cam}/image?t=' + Date.now();
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
  const items = dates.map((d) => `<li><a href="/${cam}/archive/${d}">${d}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Archiv ${label}</title>
<style>${SHARED_CSS}
  ul { list-style: none; padding: 0; }
  li { margin: 0.4rem 0; }
</style>
</head>
<body>
  <div class="switch">${switcherHtml(cam, "archive")}</div>
  <a class="back" href="/${cam}">&larr; Live-Webcam ${label}</a>
  <h1>Archiv ${label}</h1>
  ${dates.length === 0 ? "<p>Noch keine archivierten Tage.</p>" : `<ul>\n${items}\n  </ul>`}
</body>
</html>`;
}

function archiveDayHtml(cam, date, hours) {
  const label = CAMERAS[cam].label;
  const figures = hours
    .map((h) => `
  <a href="/${cam}/archive/${date}/${h}.jpg">
    <figure>
      <img src="/${cam}/archive/${date}/${h}.jpg" alt="${h} Uhr" loading="lazy">
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
<style>${SHARED_CSS}
  a { text-decoration: none; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
  figure { margin: 0; }
  img { width: 100%; border-radius: 6px; display: block; }
  figcaption { text-align: center; font-size: 0.8rem; opacity: 0.7; margin-top: 0.25rem; }
</style>
</head>
<body>
  <a class="back" href="/${cam}/archive">&larr; Archiv-Ubersicht ${label}</a>
  <h1>${label} ${date}</h1>
  ${hours.length === 0 ? "<p>Fur diesen Tag sind keine Bilder archiviert.</p>" : `<div class="grid">${figures}</div>`}
</body>
</html>`;
}

async function listArchiveDates(bucket, prefix) {
  const result = await bucket.list({ prefix, delimiter: "/" });
  return (result.delimitedPrefixes || [])
    .map((p) => p.slice(prefix.length, -1))
    .filter((d) => DATE_RE.test(d))
    .sort()
    .reverse()
    .slice(0, MAX_ARCHIVE_DATES);
}

async function listArchiveHours(bucket, prefix, date) {
  const dayPrefix = `${prefix}${date}/`;
  const result = await bucket.list({ prefix: dayPrefix });
  return (result.objects || [])
    .map((o) => o.key.slice(dayPrefix.length))
    .filter((k) => HOUR_FILE_RE.test(k))
    .map((k) => k.slice(0, 2))
    .sort();
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

async function handleArchiveIndex(env, cam, camConfig) {
  const dates = await listArchiveDates(env.WEBCAM_BUCKET, camConfig.archivePrefix);
  return new Response(archiveIndexHtml(cam, dates), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleArchiveDay(env, cam, camConfig, date) {
  if (!DATE_RE.test(date)) {
    return new Response("not found", { status: 404 });
  }
  const hours = await listArchiveHours(env.WEBCAM_BUCKET, camConfig.archivePrefix, date);
  return new Response(archiveDayHtml(cam, date, hours), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function handleArchiveHour(env, camConfig, date, hourFile) {
  if (!DATE_RE.test(date) || !HOUR_FILE_RE.test(hourFile)) {
    return new Response("not found", { status: 404 });
  }
  const object = await env.WEBCAM_BUCKET.get(`${camConfig.archivePrefix}${date}/${hourFile}`);
  if (!object) {
    return new Response("not found", { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      // Archived frames never change once written, so let the edge (and
      // browser) cache them indefinitely.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

// Cron handler: copy each camera's current snapshot into the hourly
// archive. Runs at the top of every hour (see [triggers] in wrangler.toml).
async function archiveAllCameras(env, now) {
  const { date, hour } = localDateAndHour(now, TIMEZONE);

  for (const [cam, camConfig] of Object.entries(CAMERAS)) {
    const latest = await env.WEBCAM_BUCKET.get(camConfig.latestKey);
    if (!latest) {
      console.log(`archive ${cam}: no image yet, skipping`);
      continue;
    }

    const ageMs = Date.now() - latest.uploaded.getTime();
    if (ageMs > STALE_THRESHOLD_MS) {
      console.log(
        `archive ${cam}: image is ${Math.round(ageMs / 1000)}s old (camera offline?), skipping`
      );
      continue;
    }

    const key = `${camConfig.archivePrefix}${date}/${hour}.jpg`;
    await env.WEBCAM_BUCKET.put(key, await latest.arrayBuffer(), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    console.log(`archive ${cam}: saved ${key}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length === 0) {
      return Response.redirect(new URL(`/${DEFAULT_CAM}`, url).toString(), 302);
    }

    const cam = parts[0];
    if (!Object.prototype.hasOwnProperty.call(CAMERAS, cam)) {
      return new Response("not found", { status: 404 });
    }
    const camConfig = CAMERAS[cam];
    const rest = parts.slice(1);

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

    if (rest[0] === "archive" && request.method === "GET") {
      if (rest.length === 1) {
        return handleArchiveIndex(env, cam, camConfig);
      }
      if (rest.length === 2) {
        return handleArchiveDay(env, cam, camConfig, rest[1]);
      }
      if (rest.length === 3) {
        return handleArchiveHour(env, camConfig, rest[1], rest[2]);
      }
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(archiveAllCameras(env, new Date(event.scheduledTime)));
  },
};
