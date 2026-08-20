# Cloudflare Worker: webcam relay

Receives JPEG snapshots from the Raspberry Pi, stores the latest one in an
R2 bucket, and serves a small auto-refreshing webcam page. Fully decoupled
from the main `fabian_graf_website` Pages project - just link to this
worker's URL from a button on the site (opens in a new tab).

## One-time setup

```bash
cd cloudflare
npm install                 # installs wrangler locally (optional, npx works too)

# Log in (opens a browser) OR export CLOUDFLARE_API_TOKEN instead.
npx wrangler login

# Create the R2 bucket referenced in wrangler.toml.
npx wrangler r2 bucket create esp-webcam

# Set the shared upload secret (generate one, e.g. `openssl rand -hex 32`).
# Must match UPLOAD_TOKEN in raspi/config.env.
npx wrangler secret put UPLOAD_TOKEN

# Deploy.
npx wrangler deploy
```

`wrangler deploy` prints the public URL, something like:

```
https://esp-webcam-relay.<your-subdomain>.workers.dev
```

- `GET  /`       -> HTML webcam page (this is what you link to from the site)
- `GET  /image`  -> raw latest JPEG
- `POST /upload` -> used by the Raspberry Pi relay script (needs the Bearer token)

## Updating

Edit `worker.js`, then `npx wrangler deploy` again.

## Custom domain (optional)

If you'd rather have this under your own domain (e.g.
`webcam.fabian-graf.de`) instead of `*.workers.dev`, add a route in the
Cloudflare dashboard under Workers & Pages > esp-webcam-relay > Settings >
Triggers > Custom Domains. No code changes needed.
