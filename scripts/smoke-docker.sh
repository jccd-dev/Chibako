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
tmp_parent="$(mktemp -d "${TMPDIR:-/tmp}/chibako-smoke.XXXXXX")"
tmp_dir="$tmp_parent/work"
vault_dir="$tmp_dir/data"
cookie_jar="$tmp_dir/cookies"
response_file="$tmp_dir/response.json"
nginx_image="${CHIBAKO_SMOKE_NGINX_IMAGE:-nginx:1.27-alpine}"

compose=(docker compose --project-directory "$repo_dir" --project-name "$project" --file "$repo_dir/docker-compose.yml")
started=0

cleanup() {
  local status=$?
  local cleanup_failed=0
  trap - EXIT INT TERM

  if (( status != 0 )) && (( started )); then
    if [[ -f "$response_file" ]]; then
      echo "Last HTTP response:" >&2
      cat "$response_file" >&2
    fi
    "${compose[@]}" logs --no-color >&2 || true
  fi
  if (( started )); then
    "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || cleanup_failed=1
  fi

  if [[ -e "$tmp_parent" ]] && ! rm -rf -- "$tmp_parent"; then
    # The app entrypoint may chown the bind mount to UID 1000. Use the already
    # validated nginx image as a root cleanup helper, scoped to this temp dir.
    if ! docker run --rm --user 0:0 \
      --mount "type=bind,src=$tmp_parent,dst=/cleanup" \
      "$nginx_image" sh -c 'rm -rf -- /cleanup/work' >/dev/null 2>&1; then
      cleanup_failed=1
    fi
    [[ ! -e "$tmp_parent/work" ]] || cleanup_failed=1
    rmdir -- "$tmp_parent" 2>/dev/null || cleanup_failed=1
  fi

  if (( cleanup_failed )); then
    echo "SMOKE CLEANUP WARNING: temporary resources may remain under $tmp_parent" >&2
    (( status == 0 )) && status=1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p -- "$vault_dir"

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
export CHIBAKO_SETUP_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"

die() {
  echo "SMOKE FAILED: $*" >&2
  exit 1
}

config="$("${compose[@]}" config)" || die "Compose configuration is invalid"
grep -Fq "host_ip: 127.0.0.1" <<<"$config" || die "Compose must bind the host port to 127.0.0.1"
grep -Fq "target: 3000" <<<"$config" || die "Compose must publish container port 3000"
grep -Fq 'proxy_set_header X-Chibako-Client-IP $remote_addr;' "$repo_dir/nginx/nginx.conf" || die "nginx must overwrite the auth client identity"

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

# Packaged static files must be traversable by the unprivileged runtime user whatever the host umask was.
"${compose[@]}" exec -T -u node chibako sh -c 'test -z "$(find /app/public \( -type d ! -perm -o=rx \) -o \( -type f ! -perm -o=r \) -print)"' \
  || die "files under /app/public are not readable by the runtime user"

password="SmokePass-12345!strong"
setup_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$port/api/setup" \
  -H 'Content-Type: application/json' \
  -c "$cookie_jar" \
  --data "$(printf '{\"password\":\"%s\",\"setupToken\":\"%s\"}' "$password" "$CHIBAKO_SETUP_TOKEN")")"
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

# Update safety nets, exercised in the packaged runtime. The maintenance marker must fence
# every vault accessor except health, so the updater can validate a new image without
# accepting user writes. The marker is toggled from inside the container, as the updater does:
# a host-side delete on a macOS bind mount can briefly lag inside the container, which would
# make the resume check flaky without proving anything about the app.
marker="/app/data/.chibako-maintenance"
notes_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' "http://127.0.0.1:$port/api/notes" -b "$cookie_jar")"
[[ "$notes_status" == "200" ]] || die "vault access before maintenance returned HTTP $notes_status"
"${compose[@]}" exec -T -u node chibako touch "$marker" || die "could not create the maintenance marker"
fenced_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' "http://127.0.0.1:$port/api/notes" -b "$cookie_jar")"
[[ "$fenced_status" == "500" ]] || die "maintenance marker did not fence vault access (HTTP $fenced_status)"
curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" | grep -Fq '"ok":true' || die "health must stay reachable during maintenance"
"${compose[@]}" exec -T -u node chibako rm -f "$marker" || die "could not remove the maintenance marker"
notes_status="$(curl -sS --max-time 5 -o "$response_file" -w '%{http_code}' "http://127.0.0.1:$port/api/notes" -b "$cookie_jar")"
[[ "$notes_status" == "200" ]] || die "vault access did not resume after maintenance (HTTP $notes_status)"

# A vault stamped by a newer release must be refused, not migrated or downgraded.
"${compose[@]}" exec -T chibako node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/brain.db");
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.pragma("user_version = 99");
  db.close();
' || die "could not stamp the disposable vault"
"${compose[@]}" restart chibako
sleep 8
guard_status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health")"
[[ "$guard_status" == "500" ]] || die "a newer-schema vault must fail health (HTTP $guard_status)"
"${compose[@]}" exec -T chibako node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/brain.db", { readonly: true });
  const version = db.pragma("user_version", { simple: true });
  db.close();
  if (version !== 99) process.exit(1);
' || die "newer-schema vault was modified by the older release"

# The updater image must carry every tool the update procedure shells out to.
updater_image="chibako-smoke-updater:$project"
docker build -q -f "$repo_dir/Dockerfile.updater" -t "$updater_image" "$repo_dir" >/dev/null || die "updater image failed to build"
docker run --rm --entrypoint sh "$updater_image" -c 'docker --version && docker compose version && flock --version && node -e "require(\"node:sqlite\")"' >/dev/null \
  || die "updater image is missing docker, compose, flock, or node:sqlite"
docker image rm "$updater_image" >/dev/null 2>&1 || true

echo "SMOKE PASSED: setup, login, SQLite write, restart persistence, Compose binding, nginx syntax, maintenance fence, schema guard, and updater image tooling"
