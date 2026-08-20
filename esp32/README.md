# ESP32-CAM firmware (AI-Thinker board)

ESP-IDF (v5.4.2) project. Connects to WiFi, initializes the OV2640 camera,
and serves a JPEG snapshot over plain HTTP at `/capture`. Advertises itself
via mDNS as `<hostname>.local` (default `espcam.local`, see `secrets.h`).

No streaming, no MJPEG - the Raspberry Pi relay script polls `/capture`
every few seconds, which is all a weather webcam needs and keeps the
ESP32's memory/CPU budget simple.

## First-time setup

```bash
cp main/secrets.h.example main/secrets.h
# edit main/secrets.h: set WIFI_SSID, WIFI_PASS, and optionally MDNS_HOSTNAME
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

Then verify from any machine on the same network:

```bash
curl -o test.jpg http://espcam.local/capture
```

## Hardware notes (AI-Thinker ESP32-CAM)

- Needs a USB-to-serial adapter (no onboard USB); connect GPIO0 to GND
  before power-up to enter flashing mode, remove it and reset to run
  normally.
- 4 MB flash, 4 MB PSRAM (`sdkconfig.defaults` configures both).
- Frame size VGA (640x480), JPEG quality 12 - tune in `cam.c` if you want
  higher resolution/quality (bigger files, more RAM/time per capture) or
  smaller/faster.
