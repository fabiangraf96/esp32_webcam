# ESP32-CAM firmware (AI-Thinker board)

ESP-IDF (v5.4.2) project. One capture per boot, then deep sleep: power up
the OV2640, initialize it, connect to WiFi, grab a JPEG frame and
`HTTPS POST` it directly to a Cloudflare Worker (`uploader.c`, using
`esp_http_client` + `esp_crt_bundle_attach` for TLS cert validation), then
`esp_deep_sleep_start()` for the rest of the interval
(`UPLOAD_INTERVAL_US`, 60s, see `main.c`).

No streaming, no MJPEG, and no local HTTP server/mDNS - the ESP32 only
makes outbound connections, nothing polls or discovers it on the LAN,
which keeps the memory/CPU budget simple and leaves headroom for the TLS
stack.

## Power management

The board used to stay fully powered between frames and, after ~3 days of
continuous operation, got hot and developed an audible regulator whine.
It now spends ~90% of each cycle in deep sleep with the camera unpowered.
See `docs/architecture.md` ("Power management") for the reasoning; the
short version:

- `main.c` runs a single capture per boot and deep-sleeps the remainder of
  the 60s interval. Every frame is therefore a fresh boot.
- `cam.c` drives PWDN (GPIO32) high and latches it with `rtc_gpio_hold_en()`
  so the sensor stays off while the CPU sleeps; the JPEG is copied to PSRAM
  so the camera is also off during the upload.
- `wifi.c` uses `WIFI_PS_MIN_MODEM`, caches the AP's channel/BSSID in RTC
  memory for a fast directed reconnect after each wake, and keeps the WiFi
  config in RAM so no NVS/flash write happens per cycle.

Two frames are captured and discarded after each power-up
(`CAM_WARMUP_FRAMES` in `main.c`) because the OV2640's auto-exposure needs
a few frames to converge from cold; raise it if the uploaded images look
too dark.

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

followed by lines like:

```
I (xxx) esp-x509-crt-bundle: Certificate validated
I (xxx) uploader: uploaded NNNN bytes
I (xxx) main: awake 6500 ms, sleeping 53500 ms
```

and then the board deep-sleeps and boots again ~60s later, so the whole
sequence repeats from the ESP-IDF banner every cycle (that is expected, it
is not a crash loop - a crash would print a panic/backtrace instead of the
`sleeping` line). On the second and later cycles you should also see
`wifi: fast connect: channel N, bssid ...`, which means the RTC-cached AP
details survived the sleep.

If you instead see `upload request failed` or `upload rejected: HTTP
401/403`, double check `UPLOAD_URL`/`UPLOAD_TOKEN` in `secrets.h` against
the Worker's deployed URL and `UPLOAD_TOKEN` secret. You can also check
`<worker-url>/ammersricht/image` from a browser to confirm frames are
actually arriving.

## Hardware notes (AI-Thinker ESP32-CAM)

- Needs a USB-to-serial adapter (no onboard USB); connect GPIO0 to GND
  before power-up to enter flashing mode, remove it and reset to run
  normally.
- 4 MB flash, 8 MB PSRAM (`sdkconfig.defaults` configures both). Uses a
  custom partition table (`partitions.csv`, single ~4 MB factory app, no
  OTA slot) since the mbedTLS/HTTPS stack pushes the binary past the
  default single-app table's 1 MB limit.
- Frame size UXGA (1600x1200, the sensor's max), JPEG quality 5 (near-best)
  - tune in `cam.c` if you want smaller/faster instead.
