# Architecture

## Cameras

Two cameras share one Worker and one R2 bucket (`weather-webcam`):

| Camera        | Hardware                      | Routes            | R2 keys                                            |
|---------------|-------------------------------|-------------------|----------------------------------------------------|
| `ammersricht` | ESP32-CAM (this repo)         | `/ammersricht/*`  | `latest_ammersricht.jpg`, `archive_ammersricht/...` |
| `weiden`      | Raspberry Pi + camera module  | `/weiden/*`       | `latest_weiden.jpg`, `archive_weiden/...`           |

The Weiden uploader lives in a separate repo
([raspi_webcam](https://github.com/fabiangraf96/raspi_webcam)); it only
needs the Worker's `/weiden/upload` route and its own bearer token.

Routes are symmetric - there are no unprefixed routes. Each camera has its
own upload secret (`UPLOAD_TOKEN`, `UPLOAD_TOKEN_WEIDEN`) so that rotating
one never affects the other.

## Why this shape

- **No streaming.** The requirement is "a few fps, not a real stream", so a
  capture-and-POST design is simpler and far more robust than
  MJPEG/RTSP/WebRTC, and trivially cacheable.
- **Direct ESP32-to-cloud, no relay host.** The ESP32 only makes outbound
  HTTPS connections to Cloudflare; nothing needs to be exposed from the
  home router, and there's no separate always-on device (e.g. a Raspberry
  Pi) required just to forward frames. This was an earlier iteration of
  the design (poll the ESP32 from a Pi on the LAN, relay from there) that
  was removed once direct HTTPS-from-firmware was confirmed to work
  reliably within the ESP32's RAM/flash budget.
- **Cloudflare R2 + Worker instead of Pages Functions in the main site
  repo.** This keeps the webcam feature fully decoupled from the private
  `fabian_graf_website` repo/build - integration there is a single link/
  button, nothing else changes. R2 is free up to 10 GB storage / 10M reads
  per month, comfortably enough for one small JPEG overwritten every 60s.
- **Shared-secret bearer token**, not full R2/S3 credentials, on the ESP32.
  If the device is ever compromised, the attacker can only overwrite the
  one webcam image, not touch the R2 bucket/account directly.
- **TLS on a classic ESP32 (not S3)** is the main technical risk: the
  mbedTLS + esp_http_client stack pushes the firmware binary past 1 MB, so
  a custom partition table (`esp32/partitions.csv`, single ~4 MB factory
  app, no OTA slot) replaces the default single-app table. Server
  certificate validation uses ESP-IDF's bundled Mozilla CA set
  (`esp_crt_bundle_attach`) rather than pinning Cloudflare's cert, so it
  keeps working across cert rotations. No local HTTP server or mDNS is
  needed anymore either (nothing polls/discovers the ESP32 - it only
  makes outbound connections), which also frees up RAM for the TLS
  buffers.

## Data flow

1. ESP32-CAM boots, joins WiFi (`esp32/main/secrets.h`), initializes the
   camera, then starts a FreeRTOS task that loops forever: grab one frame
   from the camera, POST it as the body of `HTTPS POST <UPLOAD_URL>` (the
   Cloudflare Worker's `/ammersricht/upload` route) with `Authorization:
   Bearer <UPLOAD_TOKEN>` and `Content-Type: image/jpeg`, release the frame
   buffer, sleep until 60s have elapsed since the cycle started.
2. The Worker's `/<camera>/upload` handler checks that camera's bearer
   token and writes the JPEG into R2 as `latest_<camera>.jpg`, overwriting
   the previous frame.
3. The Worker's `/<camera>` handler serves a tiny HTML page with an `<img>`
   that points at `/<camera>/image` (which streams the latest JPEG straight
   from R2, `Cache-Control: no-store`) and a `setInterval` that reloads it
   every 30s (deliberately shorter than the 60s upload interval, so a fresh
   frame shows up in the browser roughly halfway through the wait on
   average). `/` redirects to the default camera.
4. Once an hour a Cron Trigger copies each camera's current image to
   `archive_<camera>/YYYY-MM-DD/HH.jpg` (Europe/Berlin). A camera that has
   not uploaded within the last 10 minutes is skipped, so an outage leaves
   a gap instead of a run of duplicated stale frames.

## Failure modes considered

- **ESP32 reboots/loses WiFi:** the upload loop's `esp_http_client_perform`
  call fails, gets logged, retried next cycle; no crash (verified: 11+
  consecutive successful upload cycles observed with no errors/reboots).
- **Cloudflare/network hiccup:** same as above, just a stale image for a
  cycle or two on the site.
- **TLS handshake overhead:** each cycle currently opens a fresh
  connection/handshake rather than reusing a keep-alive session; at a 60s
  interval this is a non-issue (well under 1% duty cycle), but if it ever
  becomes relevant at a much shorter interval, reusing the
  `esp_http_client` handle across cycles is the first thing to try.
