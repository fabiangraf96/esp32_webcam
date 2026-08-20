# Raspberry Pi relay script

Polls a JPEG snapshot from the ESP32-CAM (`ESP_CAPTURE_URL`) every
`INTERVAL_SECONDS` and forwards it to the Cloudflare Worker (`UPLOAD_URL`).
Runs as a systemd service so it survives reboots and network hiccups.

## Setup

```bash
cp config.env.example config.env
# edit config.env: ESP_CAPTURE_URL, UPLOAD_URL, UPLOAD_TOKEN
```

`config.env` is gitignored and must never be committed. `UPLOAD_TOKEN` must
match the secret set on the Cloudflare Worker
(`npx wrangler secret put UPLOAD_TOKEN` in `cloudflare/`).

## Deploy to the Pi

From a machine with SSH access to the Pi:

```bash
./install.sh fabian@raspberrypi2.local
```

This copies `webcam_relay.py` + `config.env` to `/opt/webcam_relay` on the
Pi, installs `webcam-relay.service` under systemd, and starts it.

Dependency: the Debian package `python3-requests` (already covers
`requests` for the system Python; no venv needed). Install it if missing:

```bash
ssh fabian@raspberrypi2.local sudo apt-get install -y python3-requests
```

## Operating

```bash
ssh fabian@raspberrypi2.local journalctl -u webcam-relay -f      # logs
ssh fabian@raspberrypi2.local sudo systemctl restart webcam-relay
ssh fabian@raspberrypi2.local sudo systemctl status webcam-relay
```
