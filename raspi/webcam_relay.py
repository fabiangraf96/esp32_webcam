#!/usr/bin/env python3
"""Poll a snapshot from the ESP32-CAM and relay it to a Cloudflare Worker.

Configuration is read entirely from environment variables (see
config.env.example). Runs forever; intended to be managed by systemd
(see webcam-relay.service), which restarts it on crash.
"""

from __future__ import annotations

import logging
import os
import sys
import time

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("webcam_relay")


def env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("missing required environment variable %s", name)
        sys.exit(1)
    return value  # type: ignore[return-value]


def main() -> None:
    esp_url = env("ESP_CAPTURE_URL", required=True)
    upload_url = env("UPLOAD_URL", required=True)
    upload_token = env("UPLOAD_TOKEN", required=True)
    interval = float(env("INTERVAL_SECONDS", "5"))
    esp_timeout = float(env("ESP_TIMEOUT_SECONDS", "8"))
    upload_timeout = float(env("UPLOAD_TIMEOUT_SECONDS", "10"))

    log.info("relaying %s -> %s every %.1fs", esp_url, upload_url, interval)

    session = requests.Session()
    headers = {
        "Authorization": f"Bearer {upload_token}",
        "Content-Type": "image/jpeg",
    }

    consecutive_failures = 0

    while True:
        cycle_start = time.monotonic()
        try:
            resp = session.get(esp_url, timeout=esp_timeout)
            resp.raise_for_status()
            frame = resp.content
            if not frame:
                raise ValueError("empty frame from camera")

            up = session.post(upload_url, data=frame, headers=headers, timeout=upload_timeout)
            up.raise_for_status()

            consecutive_failures = 0
            log.info("relayed frame (%d bytes)", len(frame))
        except Exception as exc:  # noqa: BLE001 - keep the loop alive no matter what
            consecutive_failures += 1
            log.warning("cycle failed (%d in a row): %s", consecutive_failures, exc)

        elapsed = time.monotonic() - cycle_start
        time.sleep(max(0.0, interval - elapsed))


if __name__ == "__main__":
    main()
