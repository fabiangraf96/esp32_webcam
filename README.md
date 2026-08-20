# esp_webcam

Weather webcam: an AI-Thinker ESP32-CAM in the home WiFi that uploads a
JPEG snapshot directly to a Cloudflare Worker every 5s over HTTPS, and
displayed on a small standalone page linked from
https://fabian-graf-website.pages.dev/.

```
ESP32-CAM (WiFi)
        |  HTTPS POST /upload every 5s (Bearer token, TLS via crt bundle)
        v
Cloudflare Worker + R2 (esp-webcam-relay)
        |  serves GET / (HTML) and GET /image (JPEG)
        v
Browser tab, linked from the main website
```

## Components

- `esp32/` - ESP-IDF firmware for the camera. See `esp32/README.md`.
- `cloudflare/` - Cloudflare Worker (upload receiver + image server + page).
  See `cloudflare/README.md`.
- `docs/architecture.md` - more detail on the design and data flow.

## Credentials

None of these are committed (see `.gitignore`):

- `esp32/main/secrets.h` - WiFi SSID/password, Cloudflare Worker upload URL
  and bearer token (copy from `secrets.h.example`)
- Cloudflare Worker secret `UPLOAD_TOKEN` (set via `wrangler secret put`) -
  must match `UPLOAD_TOKEN` in `esp32/main/secrets.h`.

## Setup order

1. `cloudflare/`: create the R2 bucket, set the `UPLOAD_TOKEN` secret,
   deploy the worker, note the resulting `*.workers.dev` URL.
2. `esp32/`: fill in `secrets.h` (WiFi creds + worker URL/token from step 1),
   build and flash.
3. Add a link/button on the main website pointing to the worker's URL
   (opens in a new tab) - no changes to the website's build needed.
