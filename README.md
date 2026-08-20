# esp_webcam

Weather webcam: an AI-Thinker ESP32-CAM in the home WiFi, polled every few
seconds by a Raspberry Pi, relayed to a Cloudflare Worker, and displayed on
a small standalone page linked from https://fabian-graf-website.pages.dev/.

```
ESP32-CAM (WiFi, /capture)
        |  HTTP GET every 5s
        v
Raspberry Pi (webcam-relay.service)
        |  HTTPS POST /upload (Bearer token)
        v
Cloudflare Worker + R2 (esp-webcam-relay)
        |  serves GET / (HTML) and GET /image (JPEG)
        v
Browser tab, linked from the main website
```

## Components

- `esp32/` - ESP-IDF firmware for the camera. See `esp32/README.md`.
- `raspi/` - Python relay script + systemd service for the Raspberry Pi.
  See `raspi/README.md`.
- `cloudflare/` - Cloudflare Worker (upload receiver + image server + page).
  See `cloudflare/README.md`.
- `docs/architecture.md` - more detail on the design and data flow.

## Credentials

None of these are committed (see `.gitignore`):

- `esp32/main/secrets.h` - WiFi SSID/password (copy from `secrets.h.example`)
- `raspi/config.env` - ESP URL, Cloudflare Worker URL, upload token (copy
  from `config.env.example`)
- Cloudflare Worker secret `UPLOAD_TOKEN` (set via `wrangler secret put`)

## Setup order

1. `esp32/`: fill in `secrets.h`, build and flash.
2. `cloudflare/`: create the R2 bucket, set the `UPLOAD_TOKEN` secret,
   deploy the worker, note the resulting `*.workers.dev` URL.
3. `raspi/`: fill in `config.env` (using the ESP32's mDNS name and the
   worker URL/token from steps 1-2), run `install.sh` to deploy.
4. Add a link/button on the main website pointing to the worker's URL
   (opens in a new tab) - no changes to the website's build needed.
