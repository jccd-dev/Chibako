#!/usr/bin/env bash
# Real installer/Compose/updater lifecycle in a disposable nested Docker daemon.
# The registry answers ghcr.io only inside this test network; nothing is published.
set -Eeuo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
project="chibako-lifecycle-$(date +%s)-$$"
app_image="${CHIBAKO_SMOKE_APP_IMAGE:-$project-app}"
updater_image="${CHIBAKO_SMOKE_UPDATER_IMAGE:-$project-updater}"

cleanup() {
  local status=$?
  local cleanup_failed=0 name
  trap - EXIT INT TERM
  if (( status != 0 )); then
    docker logs --tail 40 "$project-daemon" >&2 || true
  fi
  for name in "$project-daemon" "$project-registry"; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker rm -fv "$name" >/dev/null 2>&1 || cleanup_failed=1
    fi
  done
  if docker network inspect "$project" >/dev/null 2>&1; then
    docker network rm "$project" >/dev/null 2>&1 || cleanup_failed=1
  fi
  [[ -n "${CHIBAKO_SMOKE_APP_IMAGE:-}" ]] || docker image rm "$app_image" >/dev/null 2>&1 || true
  [[ -n "${CHIBAKO_SMOKE_UPDATER_IMAGE:-}" ]] || docker image rm "$updater_image" >/dev/null 2>&1 || true
  if (( cleanup_failed )); then
    echo "Cleanup failed; check Docker resources named $project" >&2
    (( status != 0 )) || status=1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

docker info >/dev/null
[[ -n "${CHIBAKO_SMOKE_APP_IMAGE:-}" ]] || docker build -t "$app_image" "$repo_dir"
[[ -n "${CHIBAKO_SMOKE_UPDATER_IMAGE:-}" ]] || docker build -f "$repo_dir/Dockerfile.updater" -t "$updater_image" "$repo_dir"
docker network create "$project" >/dev/null
docker run -d --name "$project-registry" --network "$project" --network-alias ghcr.io \
  -e REGISTRY_HTTP_ADDR=0.0.0.0:80 registry:2 >/dev/null
# Privilege belongs only to this disposable nested daemon; the host socket is never mounted.
docker run -d --privileged --name "$project-daemon" --network "$project" \
  -e DOCKER_TLS_CERTDIR= docker:28-dind --insecure-registry ghcr.io >/dev/null
ready=0
for _ in {1..60}; do
  if docker exec "$project-daemon" docker info >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
(( ready )) || { echo "Nested Docker daemon did not start" >&2; exit 1; }
docker exec "$project-daemon" apk add --no-cache bash curl >/dev/null
docker save "$app_image" "$updater_image" | docker exec -i "$project-daemon" docker load >/dev/null
docker exec "$project-daemon" docker tag "$app_image" chibako-lifecycle-app:fixture
docker exec "$project-daemon" docker tag "$updater_image" chibako-lifecycle-updater:fixture
docker exec "$project-daemon" mkdir -p /work/release
docker cp "$repo_dir/scripts/install.sh" "$project-daemon:/work/install.sh"
docker cp "$repo_dir/docker-compose.release.yml" "$project-daemon:/work/release/docker-compose.release.yml"
docker cp "$repo_dir/tests/fixtures/docker-lifecycle.sh" "$project-daemon:/work/run.sh"
docker exec "$project-daemon" bash /work/run.sh
