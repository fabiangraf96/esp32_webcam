# Cloudflare Worker: webcam relay

Receives JPEG snapshots uploaded directly by two cameras - the ESP32-CAM
("ammersricht") and a Raspberry Pi + camera module ("weiden") - stores the
latest snapshot per camera in an R2 bucket, keeps an hourly rollup archive
per camera, and serves small auto-refreshing webcam pages. Fully decoupled
from the main `fabian_graf_website` Pages project - the site links to
`/image`, `/weiden/image`, `/archive` and `/weiden/archive` and drives its
own camera selector.

## Two cameras

| Camera      | Path prefix  | Upload token env var   | R2 keys                                  |
|-------------|--------------|-------------------------|-------------------------------------------|
| Ammersricht | (none, legacy) | `UPLOAD_TOKEN`         | `latest.jpg`, `archive/YYYY-MM-DD/HH.jpg` |
| Weiden      | `/weiden`    | `UPLOAD_TOKEN_WEIDEN`   | `weiden/latest.jpg`, `weiden/archive/YYYY-MM-DD/HH.jpg` |

Ammersricht keeps its original unprefixed routes/keys for backwards
compatibility with the already-flashed ESP32 firmware and existing R2 data.
Every route is also reachable prefixed with `/ammersricht` if you prefer to
be explicit.

Each camera's hourly archive slot for the current hour is filled by
whichever `POST .../upload` is the first to arrive after that hour started
(Europe/Berlin local time) - no Cron Trigger needed, since both cameras
upload roughly every 60s on their own.

## One-time setup

`wrangler.toml` intentionally does not hardcode an `account_id` (keeps the
file safe to make public later). Either:

- `npx wrangler login` (opens a browser, ties the session to one account), or
- export both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (needed if
  your API token doesn't have the `Account: Membership Read` permission,
  which is what `wrangler` normally uses to auto-detect the account id).
  Find your account id in the Cloudflare dashboard URL
  (`dash.cloudflare.com/<account_id>/...`) or under Workers & Pages >
  Overview > Account ID (right sidebar).

```bash
cd cloudflare
npm install                 # installs wrangler locally (optional, npx works too)

export CLOUDFLARE_API_TOKEN=...     # if not using `wrangler login`
export CLOUDFLARE_ACCOUNT_ID=...    # if not using `wrangler login`

# Create the R2 bucket referenced in wrangler.toml.
npx wrangler r2 bucket create esp-webcam

# Set the shared upload secrets (generate with e.g. `openssl rand -hex 32`).
# UPLOAD_TOKEN must match esp32/main/secrets.h (Ammersricht/ESP32-CAM).
# UPLOAD_TOKEN_WEIDEN must match config.env on the Raspberry Pi (Weiden).
npx wrangler secret put UPLOAD_TOKEN
npx wrangler secret put UPLOAD_TOKEN_WEIDEN

# Deploy.
npx wrangler deploy
```

`wrangler deploy` prints the public URL, something like:

```
https://esp-webcam-relay.<your-subdomain>.workers.dev
```

- `GET  /`              -> HTML webcam page, Ammersricht (this is what the site links to)
- `GET  /image`         -> raw latest JPEG, Ammersricht
- `POST /upload`        -> used by the ESP32-CAM firmware (needs the Bearer token)
- `GET  /archive[...]`  -> hourly archive, Ammersricht
- `GET  /weiden`               -> HTML webcam page, Weiden
- `GET  /weiden/image`         -> raw latest JPEG, Weiden
- `POST /weiden/upload`        -> used by the Raspberry Pi script (needs its own Bearer token)
- `GET  /weiden/archive[...]`  -> hourly archive, Weiden

## Updating

Edit `worker.js`, then `npx wrangler deploy` again.

## Custom domain (optional)

If you'd rather have this under your own domain (e.g.
`webcam.fabian-graf.de`) instead of `*.workers.dev`, add a route in the
Cloudflare dashboard under Workers & Pages > esp-webcam-relay > Settings >
Triggers > Custom Domains. No code changes needed.
