#!/bin/sh
# Runs as root, then drops to `node` for the actual process.
#
# Why: a bind-mounted ./data is created by the host (often root-owned), and the
# app's `node` user (UID 1000) cannot write brain.db into it. Chowning here
# makes the image self-sufficient regardless of who created the host dir,
# while the application itself never runs as root. This mirrors the official
# Postgres/MySQL/Redis images.
set -e

data="${DATA_DIR:-/app/data}"
mkdir -p "$data"
chown -R node:node "$data"

exec gosu node "$@"
