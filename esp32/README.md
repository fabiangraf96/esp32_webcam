# ESP32-CAM firmware (AI-Thinker board)

ESP-IDF (v5.4.2) project. Connects to WiFi, initializes the OV2640 camera,
then loops forever: grab a JPEG frame and `HTTPS POST` it directly to a
Cloudflare Worker (`uploader.c`, using `esp_http_client` +
`esp_crt_bundle_attach` for TLS cert validation), every `UPLOAD_INTERVAL_MS`
(5000ms, see `main.c`).

No streaming, no MJPEG, and no local HTTP server/mDNS - the ESP32 only
makes outbound connections, nothing polls or discovers it on the LAN,
which keeps the memory/CPU budget simple and leaves headroom for the TLS
stack.

## First-time setup

```bash
cp main/secrets.h.example main/secrets.h
# edit main/secrets.h: set WIFI_SSID, WIFI_PASS, UPLOAD_URL, UPLOAD_TOKEN
# (UPLOAD_URL/UPLOAD_TOKEN come from cloudflare/README.md's setup -
# UPLOAD_TOKEN must match the Worker's `UPLOAD_TOKEN` secret)
```

`secrets.h` is gitignored and must never be committed.

## Build and flash

```bash
./build.sh          # sets target to esp32, builds
```

To flash (adjust the port; on this machine it showed up as
`/dev/ttyUSB0` via `usb-1a86_USB_Serial-if00-port0`):

```bash
export IDF_PATH=$HOME/esp/esp-idf
. $IDF_PATH/export.sh
idf.py -p /dev/ttyUSB0 flash monitor
```

Ctrl+] to exit the monitor. Watch the log for the line:

```
I (xxx) wifi: got ip: 192.168.x.x
```

followed by repeating lines like:

```
I (xxx) esp-x509-crt-bundle: Certificate validated
I (xxx) uploader: uploaded NNNN bytes
```

every ~5s. If you instead see `upload request failed` or `upload
rejected: HTTP 401/403`, double check `UPLOAD_URL`/`UPLOAD_TOKEN` in
`secrets.h` against the Worker's deployed URL and `UPLOAD_TOKEN` secret.
You can also check `<worker-url>/image` from a browser to confirm frames
are actually arriving.

## Hardware notes (AI-Thinker ESP32-CAM)

- Needs a USB-to-serial adapter (no onboard USB); connect GPIO0 to GND
  before power-up to enter flashing mode, remove it and reset to run
  normally.
- 4 MB flash, 4 MB PSRAM (`sdkconfig.defaults` configures both). Uses a
  custom partition table (`partitions.csv`, single ~4 MB factory app, no
  OTA slot) since the mbedTLS/HTTPS stack pushes the binary past the
  default single-app table's 1 MB limit.
- Frame size VGA (640x480), JPEG quality 12 - tune in `cam.c` if you want
  higher resolution/quality (bigger files, more RAM/time per capture) or
  smaller/faster.
