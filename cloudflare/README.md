# Cloudflare Worker: webcam relay

Receives JPEG snapshots uploaded directly by two cameras - the ESP32-CAM
("ammersricht") and a Raspberry Pi + camera module ("weiden") - stores the
latest snapshot per camera in the `weather-webcam` R2 bucket, keeps an
hourly rollup archive per camera, and serves small auto-refreshing webcam
pages. Fully decoupled from the main `fabian_graf_website` Pages project -
the site just embeds `/<camera>/image` and links to `/<camera>/archive`.

## Two cameras

| Camera      | Route prefix    | Upload token env var  | R2 keys                                                     |
|-------------|-----------------|-----------------------|-------------------------------------------------------------|
| Ammersricht | `/ammersricht`  | `UPLOAD_TOKEN`        | `latest_ammersricht.jpg`, `archive_ammersricht/YYYY-MM-DD/HH.jpg` |
| Weiden      | `/weiden`       | `UPLOAD_TOKEN_WEIDEN` | `latest_weiden.jpg`, `archive_weiden/YYYY-MM-DD/HH.jpg`      |

Routes are symmetric: every camera is addressed as `/<camera>/...`, and `/`
redirects to the default camera. Each camera has its own upload secret, so
rotating one never affects the other.

The hourly archive is written by a Cron Trigger (`0 * * * *`, declared in
`wrangler.toml`) that copies each camera's current image into
`archive_<camera>/YYYY-MM-DD/HH.jpg` using Europe/Berlin local time. A
camera whose image is older than 10 minutes when the cron fires is skipped,
so an outage produces a gap rather than repeated stale frames.

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
npx wrangler r2 bucket create weather-webcam

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

- `GET  /`                          -> redirect to the default camera
- `GET  /ammersricht`               -> HTML webcam page
- `GET  /ammersricht/image`         -> raw latest JPEG
- `POST /ammersricht/upload`        -> used by the ESP32-CAM firmware (Bearer `UPLOAD_TOKEN`)
- `GET  /ammersricht/archive[...]`  -> hourly archive
- `GET  /weiden`                    -> HTML webcam page
- `GET  /weiden/image`              -> raw latest JPEG
- `POST /weiden/upload`             -> used by the Raspberry Pi script (Bearer `UPLOAD_TOKEN_WEIDEN`)
- `GET  /weiden/archive[...]`       -> hourly archive

## Updating

Edit `worker.js`, then `npx wrangler deploy` again.

## Custom domain (optional)

If you'd rather have this under your own domain (e.g.
`webcam.fabian-graf.de`) instead of `*.workers.dev`, add a route in the
Cloudflare dashboard under Workers & Pages > esp-webcam-relay > Settings >
Triggers > Custom Domains. No code changes needed.
