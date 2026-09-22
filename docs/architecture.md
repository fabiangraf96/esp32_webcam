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

1. The ESP32-CAM runs one capture per boot and then deep-sleeps; there is no
   long-lived task. Each cycle: power the OV2640 up (release the PWDN latch
   held through sleep), initialize the camera, join WiFi
   (`esp32/main/secrets.h`), discard two warm-up frames, grab one frame,
   copy it into PSRAM so the sensor can be powered down before transmitting,
   POST it as the body of `HTTPS POST <UPLOAD_URL>` (the Cloudflare Worker's
   `/ammersricht/upload` route) with `Authorization: Bearer <UPLOAD_TOKEN>`
   and `Content-Type: image/jpeg`, then deep-sleep for the remainder of the
   60s. See "Power management" below.
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

## Power management

The first version kept everything powered continuously: the upload task sat
in `vTaskDelay`, the OV2640 free-ran, and WiFi power save was explicitly
disabled. After ~3 days of uninterrupted operation the board developed an
audible whine (coil whine from the on-board regulator under constant load)
and ran hot. Since a frame is only needed once every 60s, a ~0.3% duty
cycle, the firmware now idles cold instead:

- **Deep sleep between cycles** (`main.c`). `app_main()` performs exactly
  one capture+upload and calls `esp_deep_sleep_start()`; the timer wakeup
  is set to `60s - <time already spent awake>`, so the cadence stays fixed
  regardless of how long the cycle took. A wake is a full boot, which has
  the side benefit that heap fragmentation can never accumulate.
- **Sensor powered down during sleep** (`cam.c`). PWDN (GPIO32) is an RTC
  pad, so it is driven high and `rtc_gpio_hold_en()` latches that level for
  the duration of the sleep. Without the latch the pad floats as soon as
  the digital core stops and the sensor would keep drawing its full active
  current while the CPU is asleep. `app_cam_power_on()` must release the
  latch on the next wake before the camera driver can claim the pin.
- **Sensor powered down during the upload too** (`main.c`). The JPEG is
  copied out of the driver's frame buffer into PSRAM so the camera can be
  deinitialized before the TLS handshake, which is the cycle's largest
  radio burst - there is no reason to have the camera's analog rail loaded
  at the same time.
- **WiFi modem sleep** (`wifi.c`). `WIFI_PS_MIN_MODEM` replaces
  `WIFI_PS_NONE`. The old setting was justified in a comment by a
  "poll-every-5s" interval that stopped being true when the interval moved
  to 60s; nothing rechecked it at the time.
- **Fast reconnect** (`wifi.c`). Channel and BSSID of the last successful
  association are cached in RTC memory (which survives deep sleep) and fed
  back into `wifi_config_t`, turning the next connect from a full
  all-channel scan into a directed probe. Wake time is the only time the
  board is expensive, so shortening it is what actually saves energy. If
  the cached AP has moved the first disconnect invalidates the cache and
  retries with a normal scan, without consuming the retry budget.
- **No NVS writes per cycle** (`wifi.c`). `esp_wifi_set_storage(WIFI_STORAGE_RAM)`
  keeps the WiFi config out of flash; at ~1440 cycles/day, letting the
  driver rewrite it on every boot would be pointless flash wear.

Two guards keep a bad cycle from becoming a hot loop: `wifi_connect()` has
a 30s timeout (rather than blocking forever), and any failure path still
falls through to `enter_deep_sleep()` instead of rebooting immediately, so
a dead sensor or a missing AP costs one frame rather than spinning the
board at full power.

## Failure modes considered

- **ESP32 reboots/loses WiFi:** the upload's `esp_http_client_perform` call
  fails, gets logged, and the board deep-sleeps and retries next cycle; no
  crash. Because every cycle is a fresh boot, a reboot is indistinguishable
  from normal operation - at worst one frame is missed.
- **Camera fails to initialize:** `app_cam_init()` returning an error sleeps
  the full interval rather than looping on the failure, giving the sensor a
  properly cold restart each time.
- **Cloudflare/network hiccup:** same as above, just a stale image for a
  cycle or two on the site.
- **TLS handshake overhead:** each cycle currently opens a fresh
  connection/handshake rather than reusing a keep-alive session; at a 60s
  interval this is a non-issue (well under 1% duty cycle), but if it ever
  becomes relevant at a much shorter interval, reusing the
  `esp_http_client` handle across cycles is the first thing to try.
