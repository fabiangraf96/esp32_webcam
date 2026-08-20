// Cloudflare Worker: receives JPEG snapshots uploaded directly by the
// ESP32-CAM, stores the latest one in R2, and serves a small
// weather-webcam page.
//
// Routes:
//   GET  /            - HTML page, auto-refreshing <img>
//   GET  /image       - latest JPEG bytes
//   POST /upload      - store a new JPEG (Authorization: Bearer <UPLOAD_TOKEN>)

const OBJECT_KEY = "latest.jpg";
const REFRESH_SECONDS = 30;

const PAGE_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wetter-Webcam</title>
<style>
  html, body {
    margin: 0; height: 100%; background: #111; color: #eee;
    font-family: system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  h1 { font-size: 1rem; font-weight: 400; opacity: 0.7; margin: 0.5rem; }
  img { max-width: 95vw; max-height: 85vh; border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
  #ts { font-size: 0.8rem; opacity: 0.5; margin-top: 0.5rem; }
</style>
</head>
<body>
  <h1>Live-Webcam</h1>
  <img id="cam" src="/image" alt="Webcam Bild">
  <div id="ts"></div>
  <script>
    const img = document.getElementById('cam');
    const ts = document.getElementById('ts');
    function refresh() {
      img.src = '/image?t=' + Date.now();
      ts.textContent = 'Letzte Aktualisierung: ' + new Date().toLocaleTimeString('de-DE');
    }
    setInterval(refresh, ${REFRESH_SECONDS * 1000});
  </script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(PAGE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/image") {
      const object = await env.WEBCAM_BUCKET.get(OBJECT_KEY);
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

    if (request.method === "POST" && url.pathname === "/upload") {
      const auth = request.headers.get("authorization") || "";
      const expected = `Bearer ${env.UPLOAD_TOKEN}`;
      if (auth !== expected) {
        return new Response("unauthorized", { status: 401 });
      }

      const body = await request.arrayBuffer();
      if (body.byteLength === 0) {
        return new Response("empty body", { status: 400 });
      }

      await env.WEBCAM_BUCKET.put(OBJECT_KEY, body, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },
};
