#!/usr/bin/env bash
# Deploys webcam_relay.py + config.env + systemd unit to the Raspberry Pi
# and (re)starts the service. Run from WSL/Linux with ssh access to the pi.
#
# Usage: ./install.sh [user@host]
# Default host: fabian@raspberrypi2.local

set -euo pipefail

HOST="${1:-fabian@raspberrypi2.local}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR=/opt/webcam_relay

if [ ! -f "$DIR/config.env" ]; then
    echo "error: $DIR/config.env not found." >&2
    echo "Copy config.env.example to config.env and fill in real values first." >&2
    exit 1
fi

echo "Deploying to $HOST:$REMOTE_DIR ..."

ssh "$HOST" "sudo mkdir -p $REMOTE_DIR && sudo chown \$(whoami):\$(whoami) $REMOTE_DIR"

scp "$DIR/webcam_relay.py" "$DIR/config.env" "$HOST:$REMOTE_DIR/"
scp "$DIR/webcam-relay.service" "$HOST:/tmp/webcam-relay.service"

ssh "$HOST" "sudo mv /tmp/webcam-relay.service /etc/systemd/system/webcam-relay.service \
    && sudo chmod 600 $REMOTE_DIR/config.env \
    && sudo systemctl daemon-reload \
    && sudo systemctl enable --now webcam-relay.service \
    && sudo systemctl status --no-pager webcam-relay.service"

echo "Done. Follow logs with: ssh $HOST journalctl -u webcam-relay -f"
