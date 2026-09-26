#!/bin/sh
# Gateway entrypoint: ensure /data is writable at RUNTIME, then drop privileges.
#
# Why this exists: Railway mounts the persistent volume over /data at container
# start, masking any ownership baked into the image at build time. The volume was
# created when the gateway ran as root, so it is root-owned; the gateway itself
# must run as the non-root "grist" user. This script runs as root, fixes
# ownership, then execs the gateway as grist via su-exec.
set -eu

mkdir -p /data
chown -R grist:grist /data

exec su-exec grist:grist bun /app/dist/gateway.js
