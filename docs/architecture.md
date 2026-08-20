# Architecture

## Why this shape

- **No streaming.** The requirement is "a few fps, not a real stream", so a
  poll-and-relay design (HTTP GET a JPEG, HTTP POST it onward) is simpler
  and far more robust than MJPEG/RTSP/WebRTC, and trivially cacheable.
- **No tunnel / port-forwarding into the home network.** The Raspberry Pi
  only makes outbound HTTPS connections to Cloudflare; nothing needs to be
  exposed from the home router. The ESP32 is only reachable from the LAN
  (via the Pi), never from the internet directly.
- **Cloudflare R2 + Worker instead of Pages Functions in the main site
  repo.** This keeps the webcam feature fully decoupled from the private
  `fabian_graf_website` repo/build - integration there is a single link/
  button, nothing else changes. R2 is free up to 10 GB storage / 10M reads
  per month, comfortably enough for one small JPEG overwritten every 5s.
- **Shared-secret bearer token**, not full R2/S3 credentials, on the Pi.
  If the Pi is ever compromised, the attacker can only overwrite the one
  webcam image, not touch the R2 bucket/account directly.

## Data flow

1. ESP32-CAM boots, joins WiFi (`esp32/main/secrets.h`), starts an HTTP
   server with a single meaningful route `GET /capture` that grabs one
   frame from the camera and returns it as `image/jpeg`. It also announces
   itself via mDNS so the Pi doesn't need a hardcoded/static IP.
2. `raspi/webcam_relay.py` runs as a systemd service, loops forever:
   `GET http://espcam.local/capture` -> `POST <worker-url>/upload` with
   `Authorization: Bearer <token>`. Errors (WiFi hiccup, ESP32 reboot,
   Cloudflare hiccup) are logged and the loop just continues.
3. The Cloudflare Worker's `/upload` handler checks the bearer token and
   writes the JPEG into R2 as `latest.jpg`, overwriting the previous frame.
4. The Worker's `/` handler serves a tiny HTML page with an `<img>` that
   points at `/image` (which streams `latest.jpg` straight from R2,
   `Cache-Control: no-store`) and a `setInterval` that reloads it every 5s.

## Failure modes considered

- **ESP32 reboots/loses WiFi:** the Pi's GET fails, gets logged, retried
  next cycle; no crash.
- **Pi reboots:** systemd `Restart=on-failure` + `WantedBy=multi-user.target`
  bring the service back automatically; `after=network-online.target`
  avoids racing DHCP/WiFi on boot.
- **Cloudflare/network hiccup:** same as above, just a stale image for a
  cycle or two on the site.
- **Stale mDNS cache:** if the ESP32 gets a new DHCP lease and the Pi's
  resolver caches the old IP, worst case is a temporary run of failed
  cycles until the resolver re-queries; acceptable for a weather cam.
