# esp_webcam

Weather webcams for https://fabian-graf-website.pages.dev/. An AI-Thinker
ESP32-CAM in the home WiFi uploads a JPEG snapshot directly to a Cloudflare
Worker every 60s over HTTPS. The Worker stores the latest frame per camera
in R2, keeps an hourly archive, and serves small standalone pages.

A second camera (a Raspberry Pi + camera module, "Weiden") uses the same
Worker; its uploader lives in
[raspi_webcam](https://github.com/fabiangraf96/raspi_webcam).

```
ESP32-CAM "ammersricht" (WiFi)          Raspberry Pi "weiden"
        |                                       |
        |  HTTPS POST /ammersricht/upload       |  HTTPS POST /weiden/upload
        |  every 60s (Bearer token)             |  every 60s (Bearer token)
        v                                       v
        +---------------------------------------+
                          |
        Cloudflare Worker "esp-webcam-relay" + R2 bucket "weather-webcam"
                          |  GET /<camera>        (HTML page)
                          |  GET /<camera>/image  (JPEG)
                          |  GET /<camera>/archive (hourly archive)
                          v
                  Browser / the main website
```

## Cameras

| Camera        | Hardware                     | Routes           | R2 keys                                                           |
|---------------|------------------------------|------------------|--------------------------------------------------------------------|
| `ammersricht` | ESP32-CAM (this repo)        | `/ammersricht/*` | `latest_ammersricht.jpg`, `archive_ammersricht/YYYY-MM-DD/HH.jpg` |
| `weiden`      | Raspberry Pi + camera module | `/weiden/*`      | `latest_weiden.jpg`, `archive_weiden/YYYY-MM-DD/HH.jpg`           |

## Components

- `esp32/` - ESP-IDF firmware for the camera. See `esp32/README.md`.
- `cloudflare/` - Cloudflare Worker (upload receiver + image server + hourly
  archive + pages). See `cloudflare/README.md`.
- `docs/architecture.md` - more detail on the design and data flow.

## Credentials

None of these are committed (see `.gitignore`):

- `esp32/main/secrets.h` - WiFi SSID/password, Cloudflare Worker upload URL
  and bearer token (copy from `secrets.h.example`)
- Cloudflare Worker secrets, set via `wrangler secret put`:
  - `UPLOAD_TOKEN` - must match `UPLOAD_TOKEN` in `esp32/main/secrets.h`
  - `UPLOAD_TOKEN_WEIDEN` - must match `config.env` in the `raspi_webcam` repo

## Setup order

1. `cloudflare/`: create the R2 bucket, set the upload secrets, deploy the
   worker, note the resulting `*.workers.dev` URL.
2. `esp32/`: fill in `secrets.h` (WiFi creds + worker URL/token from step 1,
   upload URL ends in `/ammersricht/upload`), build and flash.
3. Point the main website at `/<camera>/image` and `/<camera>/archive`.
