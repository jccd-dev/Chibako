#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "UNVERIFIED: Docker CLI is not installed." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "UNVERIFIED: Docker daemon is unavailable; start Docker and retry." >&2
  exit 2
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "UNVERIFIED: Docker Compose is unavailable." >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "UNVERIFIED: curl is required for HTTP checks." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "UNVERIFIED: Node.js is required to select a free loopback port." >&2
  exit 2
fi

project="chibako-smoke-$(date +%s)-$$"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/chibako-smoke.XXXXXX")"
vault_dir="$tmp_dir/data"
cookie_jar="$tmp_dir/cookies"
response_file="$tmp_dir/response.json"
mkdir -p "$vault_dir"

port="$(node -e '
  const net = require("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    console.log(server.address().port);
    server.close();
  });
')"

export CHIBAKO_PORT="$port"
export CHIBAKO_DATA_VOLUME="$vault_dir"

compose=(docker compose --project-directory "$repo_dir" --project-name "$project" --file "$repo_dir/docker-compose.yml")
started=0

cleanup() {
  local status=$?
  if (( status != 0 )) && (( started )); then
    "${compose[@]}" logs --no-color >&2 || true
  fi
  if (( started )); then
    "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

die() {
  echo "SMOKE FAILED: $*" >&2
  exit 1
}

config="$("${compose[@]}" config)" || die "Compose configuration is invalid"
grep -Fq "host_ip: 127.0.0.1" <<<"$config" || die "Compose must bind the host port to 127.0.0.1"
grep -Fq "target: 3000" <<<"$config" || die "Compose must publish container port 3000"

nginx_image="${CHIBAKO_SMOKE_NGINX_IMAGE:-nginx:1.27-alpine}"
docker run --rm \
  --mount "type=bind,src=$repo_dir/nginx/nginx.conf,dst=/etc/nginx/conf.d/chibako.conf,readonly" \
  "$nginx_image" nginx -t >/dev/null || die "nginx template failed validation"

echo "Building and starting $project on 127.0.0.1:$port"
started=1
"${compose[@]}" up -d --build

wait_for_health() {
  local url="http://127.0.0.1:$port/api/health"
  local body=""
  for _ in {1..60}; do
    if body="$(curl -fsS --max-time 2 "$url" 2>/dev/null)" && [[ "$body" == *'"ok":true'* ]]; then
      return 0
    fi
    sleep 1
  done
  die "health check did not become ready"
}

wait_for_health

password="SmokePass-12345!"
setup_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$port/api/setup" \
  -H 'Content-Type: application/json' \
  -c "$cookie_jar" \
  --data "$(printf '{\"password\":\"%s\"}' "$password")")"
[[ "$setup_status" == "200" ]] || die "fresh setup returned HTTP $setup_status"
grep -Fq '"ok":true' "$response_file" || die "fresh setup did not return ok=true"

curl -fsS --max-time 5 -X POST "http://127.0.0.1:$port/api/logout" \
  -b "$cookie_jar" -c "$cookie_jar" >/dev/null || die "logout failed"

login_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$port/api/login" \
  -H 'Content-Type: application/json' \
  -b "$cookie_jar" -c "$cookie_jar" \
  --data "$(printf '{\"password\":\"%s\"}' "$password")")"
[[ "$login_status" == "200" ]] || die "login returned HTTP $login_status"
grep -Fq '"ok":true' "$response_file" || die "login did not return ok=true"

note_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$port/api/notes" \
  -H 'Content-Type: application/json' \
  -b "$cookie_jar" \
  --data '{"title":"Smoke persistence","content":"created by the isolated Docker smoke check"}')"
[[ "$note_status" == "201" ]] || die "note creation returned HTTP $note_status"
grep -Fq '"title":"Smoke persistence"' "$response_file" || die "note creation response was incomplete"
[[ -s "$vault_dir/brain.db" ]] || die "SQLite database was not created in the isolated vault"

"${compose[@]}" exec -T chibako node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/brain.db");
  const row = db.prepare("SELECT 1 FROM notes WHERE title = ?").get("Smoke persistence");
  db.close();
  if (!row) process.exit(1);
' || die "packaged runtime could not read the persisted SQLite note"

"${compose[@]}" down --remove-orphans
"${compose[@]}" up -d
wait_for_health

notes_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' \
  "http://127.0.0.1:$port/api/notes" -b "$cookie_jar")"
[[ "$notes_status" == "200" ]] || die "notes lookup after restart returned HTTP $notes_status"
grep -Fq '"title":"Smoke persistence"' "$response_file" || die "note did not survive the container restart"

echo "SMOKE PASSED: setup, login, SQLite write, restart persistence, Compose binding, and nginx syntax"
