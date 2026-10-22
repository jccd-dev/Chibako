#!/usr/bin/env bash
# Exit 0 when <version> may become the "latest" release, 1 when a newer one already is.
# usage: should-promote.sh <current-latest-tag-or-empty> <version>
# A re-run of an older failed workflow must not move `latest` backwards.
set -euo pipefail
current="${1#v}"
candidate="$2"
[[ "$candidate" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected version: $candidate" >&2; exit 2; }
[[ -z "$current" ]] && exit 0
[[ "$current" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected latest release: $1" >&2; exit 2; }
IFS=. read -r cm cn cp <<<"$current"
IFS=. read -r vm vn vp <<<"$candidate"
for pair in "$vm:$cm" "$vn:$cn" "$vp:$cp"; do
  (( ${pair%:*} > ${pair#*:} )) && exit 0
  (( ${pair%:*} < ${pair#*:} )) && exit 1
done
exit 0 # same version: an idempotent re-run
