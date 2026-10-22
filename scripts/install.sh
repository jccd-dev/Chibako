#!/usr/bin/env bash
# Chibako installer: install, re-run (idempotent), adopt an existing Compose
# deployment, status, uninstall.
#
#   curl -fsSL https://github.com/jccd-dev/chibako/releases/latest/download/install.sh | bash
#   ... | bash -s -- uninstall
#
# Supported: Linux amd64 with Docker Engine and the Compose plugin. Rootless Docker
# and Docker Desktop are not tested. The updater container mounts the Docker
# socket, which is host-root equivalent; it only acts on the config written here.
set -Eeuo pipefail
umask 077

RELEASE_BASE="${CHIBAKO_RELEASE_BASE:-https://github.com/jccd-dev/chibako/releases/latest/download}"
MARKER="# managed-by: chibako-installer"
SAFE_PATH='^/[A-Za-z0-9._/-]+$'
SAFE_NAME='^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'
IMAGE_RE='^ghcr\.io/jccd-dev/chibako@sha256:[0-9a-f]{64}$'
UPDATER_RE='^ghcr\.io/jccd-dev/chibako-updater@sha256:[0-9a-f]{64}$'

die() { echo "chibako: $*" >&2; exit 1; }

usage() {
  cat >&2 <<USAGE
Usage: install.sh [install|status|uninstall|adopt|migrate] [options]
  install                 (default) install or refresh the updater; never touches your data or env
  status                  show what is installed
  uninstall               stop the containers; keeps data, backups, and configuration
  adopt                   attach the updater to an existing Compose deployment:
      --compose FILE      (repeatable) your Compose file(s)
      --env-file FILE     (repeatable) env files Compose reads
      --service NAME      the Chibako service
      --project NAME      Compose project name
      --data DIR          the vault directory mounted at /app/data
      --pin-file FILE     dotenv file holding the image pin (the updater edits only that line)
      --pin-var NAME      variable your Compose file uses for the Chibako image
      --lock-file FILE    lock shared with your deploy tooling (flock)
      --confirm-no-external-writers
                          required: nothing outside the Chibako container (for example a local
                          stdio MCP server from an older release) is writing to the vault
      --prepare-only      write the updater files and stop; do not start the updater or update
  migrate                 move a source-built deployment onto the managed image, keeping its data:
      --from DIR          the checkout holding docker-compose.yml (and .env) of the running source build
      --confirm-no-external-writers
Environment: CHIBAKO_HOME (default \$HOME/chibako), CHIBAKO_PORT, SITE_NAME.
USAGE
  exit 64
}

command="${1:-install}"
[[ $# -gt 0 ]] && shift

home="${CHIBAKO_HOME:-$HOME/chibako}"
[[ "$home" =~ $SAFE_PATH && "$home" != *..* ]] || die "CHIBAKO_HOME must be an absolute path using only letters, digits, . _ - and /"

prerequisites() {
  [[ "$(uname -s)" == "Linux" ]] || die "only Linux is supported by the installer"
  case "$(uname -m)" in x86_64|amd64) ;; *) die "only amd64 images are published";; esac
  command -v docker >/dev/null || die "Docker is required"
  command -v curl >/dev/null || die "curl is required"
  docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is required"
  docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable by this user"
  if docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    echo "chibako: warning: rootless Docker has not been tested with the updater." >&2
  fi
}

fetch() { # fetch <asset> <dest>
  local opts=(-fsSL --max-time 60 --max-filesize 1048576)
  if [[ "$RELEASE_BASE" == file://* ]]; then opts+=(--proto '=file'); else opts+=(--proto '=https' --tlsv1.2); fi
  curl "${opts[@]}" -o "$2" "$RELEASE_BASE/$1" || die "could not download $1 from the latest release"
}

# Reads KEY=VALUE from release.env after validating every line against a fixed pattern.
release_value() { # release_value <file> <key>
  grep -E "^$2=" "$1" | head -1 | cut -d= -f2-
}

with_lock() { # with_lock <lockfile> <command...> -- serialise with the updater and host deploy tooling
  local lock="$1"; shift
  if command -v flock >/dev/null; then
    ( exec 9>"$lock"; flock -n 9 || die "another update or deployment is running; try again shortly"; "$@" )
  else
    echo "chibako: warning: flock not found; make sure no update is running." >&2
    "$@"
  fi
}

write_env_line() { # write_env_line <file> <key> <value> (append only when absent)
  grep -qE "^$2=" "$1" 2>/dev/null || printf '%s=%s\n' "$2" "$3" >>"$1"
}

wait_healthy() { # wait_healthy <compose args...>
  local id i status
  for i in $(seq 1 90); do
    id="$("$@" ps -q chibako 2>/dev/null | head -1)"
    status="$([[ -n "$id" ]] && docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
    [[ "$status" == *"|healthy" ]] && return 0
    sleep 2
  done
  return 1
}

# Same layout and modes as `updater init`: the app runs as another uid and must reach both channel dirs.
prepare_channel() {
  mkdir -p "$home/backups" "$home/updater/channel/in" "$home/updater/channel/out"
  chmod 755 "$home/updater" "$home/updater/channel" "$home/updater/channel/out"
  chmod 1777 "$home/updater/channel/in"
}

wait_running() { # wait_running <compose args...> -- the updater service is up
  local id i
  for i in $(seq 1 30); do
    id="$("$@" ps -q updater 2>/dev/null | head -1)"
    [[ -n "$id" && "$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null)" == *running* ]] && return 0
    sleep 1
  done
  return 1
}

do_install() {
  prerequisites
  mkdir -p "$home/data"
  prepare_channel

  if [[ -e "$home/compose.yml" ]] && ! grep -qxF "$MARKER" "$home/compose.yml"; then
    die "$home/compose.yml was not written by this installer and will not be overwritten. Use 'adopt' for an existing deployment."
  fi

  local work; work="$(mktemp -d)"; trap "rm -rf '$work'" EXIT
  fetch release.env "$work/release.env"
  fetch docker-compose.release.yml "$work/compose.yml"
  grep -qxF "$MARKER" "$work/compose.yml" || die "downloaded Compose file is not an installer-managed file"
  local app_image updater_image version
  app_image="$(release_value "$work/release.env" CHIBAKO_IMAGE)"
  updater_image="$(release_value "$work/release.env" CHIBAKO_UPDATER_IMAGE)"
  version="$(release_value "$work/release.env" CHIBAKO_RELEASE_VERSION)"
  [[ "$app_image" =~ $IMAGE_RE ]] || die "release metadata has an unexpected application image"
  [[ "$updater_image" =~ $UPDATER_RE ]] || die "release metadata has an unexpected updater image"

  with_lock "$home/updater/.deploy.lock" apply_install "$work" "$app_image" "$updater_image" "$version"
}

apply_install() {
  local work="$1" app_image="$2" updater_image="$3" version="$4"

  # Environment: created once, never rewritten, so a re-run keeps your settings and setup token.
  local env_file="$home/.env"
  local fresh=0; [[ -e "$env_file" ]] || fresh=1
  touch "$env_file"; chmod 600 "$env_file"
  write_env_line "$env_file" CHIBAKO_HOME "$home"
  write_env_line "$env_file" CHIBAKO_DATA_VOLUME "$home/data"
  write_env_line "$env_file" CHIBAKO_PORT "${CHIBAKO_PORT:-3000}"
  write_env_line "$env_file" SITE_NAME "${SITE_NAME:-Chibako}"
  write_env_line "$env_file" CHIBAKO_TRUST_PROXY false
  if [[ $fresh -eq 1 ]]; then
    printf 'CHIBAKO_SETUP_TOKEN=%s\n' "$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 64)" >>"$env_file"
  fi

  local data
  data="$(grep '^CHIBAKO_DATA_VOLUME=' "$env_file" | tail -1 | cut -d= -f2-)"
  [[ "$data" =~ $SAFE_PATH && "$data" != *..* ]] || die "CHIBAKO_DATA_VOLUME must be an absolute host directory"

  # Pin: the app digest is only set on first install (the updater owns it afterwards); the updater image follows the installer.
  local pin_file="$home/pin.env"
  touch "$pin_file"; chmod 600 "$pin_file"
  grep -qE '^CHIBAKO_IMAGE=' "$pin_file" || printf 'CHIBAKO_IMAGE=%s\n' "$app_image" >>"$pin_file"
  if grep -qE '^CHIBAKO_UPDATER_IMAGE=' "$pin_file"; then
    local tmp="$pin_file.tmp"; grep -vE '^CHIBAKO_UPDATER_IMAGE=' "$pin_file" >"$tmp" || true
    printf 'CHIBAKO_UPDATER_IMAGE=%s\n' "$updater_image" >>"$tmp"; chmod 600 "$tmp"; mv "$tmp" "$pin_file"
  else
    printf 'CHIBAKO_UPDATER_IMAGE=%s\n' "$updater_image" >>"$pin_file"
  fi

  cat >"$home/updater/config.json" <<JSON
{
  "projectName": "chibako",
  "projectDir": "$home",
  "composeFiles": ["$home/compose.yml"],
  "envFiles": ["$home/.env", "$home/pin.env"],
  "service": "chibako",
  "pinFile": "$home/pin.env",
  "pinVar": "CHIBAKO_IMAGE",
  "dataDir": "$data",
  "backupDir": "$home/backups",
  "controlDir": "$home/updater",
  "lockFile": "$home/updater/.deploy.lock"
}
JSON
  chmod 644 "$home/updater/config.json"
  install -m 644 "$work/compose.yml" "$home/compose.yml"

  local compose=(docker compose -p chibako --project-directory "$home" --env-file "$home/.env" --env-file "$home/pin.env" -f "$home/compose.yml")
  echo "Pulling pinned images..."
  docker pull --quiet "$(grep '^CHIBAKO_UPDATER_IMAGE=' "$pin_file" | cut -d= -f2-)" >/dev/null
  local pinned_app; pinned_app="$(grep '^CHIBAKO_IMAGE=' "$pin_file" | cut -d= -f2-)"
  [[ "$pinned_app" != *@* ]] || docker pull --quiet "$pinned_app" >/dev/null # a local rollback tag has no registry copy
  "${compose[@]}" up -d --no-build --pull never
  wait_healthy "${compose[@]}" || die "Chibako did not become healthy; check: ${compose[*]} logs"

  echo "Chibako is running at http://127.0.0.1:$(grep '^CHIBAKO_PORT=' "$env_file" | cut -d= -f2-)"
  if [[ $fresh -eq 1 ]]; then
    echo "First-run setup token (also saved in $env_file): $(grep '^CHIBAKO_SETUP_TOKEN=' "$env_file" | cut -d= -f2-)"
  fi
  echo "Data: $data   Backups: $home/backups   Uninstall: install.sh uninstall"
}

do_adopt() {
  prerequisites
  local composes=() envs=() service="" project="" data="" pin_file="" pin_var="" lock="" ack=0 bootstrap=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --compose) composes+=("$2"); shift 2;;
      --env-file) envs+=("$2"); shift 2;;
      --service) service="$2"; shift 2;;
      --project) project="$2"; shift 2;;
      --data) data="$2"; shift 2;;
      --pin-file) pin_file="$2"; shift 2;;
      --pin-var) pin_var="$2"; shift 2;;
      --lock-file) lock="$2"; shift 2;;
      --confirm-no-external-writers) ack=1; shift;;
      --prepare-only) bootstrap=0; shift;;
      *) usage;;
    esac
  done
  [[ ${#composes[@]} -gt 0 && -n "$service" && -n "$project" && -n "$data" && -n "$pin_file" && -n "$pin_var" ]] || usage
  lock="${lock:-$home/updater/.deploy.lock}"
  # The pin file always takes part, last, so the updater's pin edit wins over any older value in another env file.
  local path ordered_envs=()
  for path in "${envs[@]:-}"; do
    [[ -z "$path" || "$path" == "$pin_file" ]] || ordered_envs+=("$path")
  done
  envs=("${ordered_envs[@]}" "$pin_file")
  for path in "${composes[@]}" "${envs[@]}" "$data" "$pin_file" "$lock"; do
    [[ "$path" =~ $SAFE_PATH && "$path" != *..* ]] || die "unsafe path: $path"
  done
  [[ "$service" =~ $SAFE_NAME && "$project" =~ $SAFE_NAME ]] || die "invalid service or project name"
  [[ "$pin_var" =~ ^[A-Z][A-Z0-9_]{0,63}$ ]] || die "invalid pin variable"
  for path in "${composes[@]}"; do
    [[ -f "$path" && ! -L "$path" ]] || die "$path must be a regular file"
  done
  [[ -f "$pin_file" && ! -L "$pin_file" ]] || die "$pin_file must be an existing regular file"
  [[ -d "$data" ]] || die "$data is not a directory"
  [[ "$(grep -cE "^$pin_var=" "$pin_file")" -eq 1 ]] || die "$pin_file must define $pin_var exactly once"
  grep -qE "^$pin_var=ghcr\\.io/jccd-dev/chibako@sha256:[0-9a-f]{64}\$" "$pin_file" \
    || die "$pin_file must already pin $pin_var to ghcr.io/jccd-dev/chibako@sha256:<digest>"
  [[ $bootstrap -eq 0 || $ack -eq 1 ]] || die "Updates cannot fence writers outside the Chibako container (for example a local stdio MCP server started from an older release). Stop them, then re-run with --confirm-no-external-writers."

  # Compose must really take the image from the pin: checked now, before anything is written or stopped.
  local check=(docker compose -p "$project" --project-directory "$(dirname "${composes[0]}")") pinned
  for path in "${envs[@]}"; do check+=(--env-file "$path"); done
  for path in "${composes[@]}"; do check+=(-f "$path"); done
  pinned="$(grep -E "^$pin_var=" "$pin_file" | cut -d= -f2-)"
  "${check[@]}" config --images 2>/dev/null | grep -qxF "$pinned" \
    || die "Compose does not take the image from $pin_var in $pin_file (check the --env-file order and the image setting in your Compose file); nothing was changed."

  local work; work="$(mktemp -d)"; trap "rm -rf '$work'" EXIT
  fetch release.env "$work/release.env"
  local updater_image app_image
  updater_image="$(release_value "$work/release.env" CHIBAKO_UPDATER_IMAGE)"
  app_image="$(release_value "$work/release.env" CHIBAKO_IMAGE)"
  [[ "$updater_image" =~ $UPDATER_RE ]] || die "release metadata has an unexpected updater image"
  [[ "$app_image" =~ $IMAGE_RE ]] || die "release metadata has an unexpected application image"

  mkdir -p "$home/backups"; prepare_channel
  local override="$home/updater/chibako-updates.override.yml"
  local files_json envs_json
  files_json="$(printf '"%s",' "${composes[@]}" "$override")"; files_json="[${files_json%,}]"
  envs_json="$(printf '"%s",' "${envs[@]}")"; envs_json="[${envs_json%,}]"
  cat >"$home/updater/config.json" <<JSON
{
  "projectName": "$project",
  "projectDir": "$(dirname "${composes[0]}")",
  "composeFiles": $files_json,
  "envFiles": $envs_json,
  "service": "$service",
  "pinFile": "$pin_file",
  "pinVar": "$pin_var",
  "dataDir": "$data",
  "backupDir": "$home/backups",
  "controlDir": "$home/updater",
  "lockFile": "$lock"
}
JSON
  chmod 644 "$home/updater/config.json"

  # Never edits the user's files: the updater runs as its own project and the app gets its channel via an override file.
  cat >"$override" <<YAML
$MARKER
services:
  $service:
    environment:
      - CHIBAKO_UPDATER_DIR=/app/updater
    volumes:
      - $home/updater/channel/in:/app/updater/in
      - $home/updater/channel/out:/app/updater/out:ro
YAML
  # Mount every host directory the updater must reach at its identical absolute path (deduplicated).
  local mounts=() mount existing seen
  local env_dirs=(); for existing in "${envs[@]}"; do env_dirs+=("$(dirname "$existing")"); done
  for mount in "$home" "$(dirname "${composes[0]}")" "$data" "$(dirname "$pin_file")" "$(dirname "$lock")" "${env_dirs[@]}"; do
    [[ -n "$mount" ]] || continue
    seen=0; for existing in "${mounts[@]:-}"; do [[ "$existing" == "$mount" ]] && seen=1; done
    [[ $seen -eq 1 ]] || mounts+=("$mount")
  done
  {
    printf '%s\nname: chibako-updater\nservices:\n  updater:\n    image: %s\n    restart: unless-stopped\n' "$MARKER" "$updater_image"
    printf '    environment:\n      - CHIBAKO_UPDATER_CONFIG=%s/updater/config.json\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n' "$home"
    for mount in "${mounts[@]}"; do printf '      - %s:%s\n' "$mount" "$mount"; done
  } >"$home/updater/updater.compose.yml"
  docker pull --quiet "$updater_image" >/dev/null

  local updater_compose=(docker compose -p chibako-updater -f "$home/updater/updater.compose.yml")
  if [[ $bootstrap -eq 0 ]]; then
    echo "Adoption prepared in $home/updater (your files were not modified). To finish:"
    echo "  1. ${updater_compose[*]} up -d"
    echo "  2. ${updater_compose[*]} exec -T updater node /usr/local/lib/chibako-updater.mjs apply $app_image"
    echo "  3. Disable any automation that writes the $pin_var pin; route emergency deploys through the same apply command."
    return 0
  fi
  # Your current image has no Update button, so the first move to the managed release is done by the updater itself:
  # same lock, backup, health gate and automatic rollback as every later update.
  "${updater_compose[@]}" up -d
  wait_running "${updater_compose[@]}" || die "the updater did not start; check: ${updater_compose[*]} logs"
  echo "Moving $service to the managed release (backup, health check, automatic rollback)..."
  "${updater_compose[@]}" exec -T updater node /usr/local/lib/chibako-updater.mjs apply "$app_image" \
    || die "the first update did not complete; your previous version was restored if it failed (see: ${updater_compose[*]} logs). Writes stay paused only if the updater reported 'needs attention'."
  echo "Adopted. Remaining: disable any automation that writes the $pin_var pin; emergency deploys go through:"
  echo "  ${updater_compose[*]} exec -T updater node /usr/local/lib/chibako-updater.mjs apply <ghcr.io/jccd-dev/chibako@sha256:...>"
}

do_migrate() {
  prerequisites
  local src="" ack=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --from) src="$2"; shift 2;;
      --confirm-no-external-writers) ack=1; shift;;
      *) usage;;
    esac
  done
  [[ -n "$src" && "$src" =~ $SAFE_PATH && "$src" != *..* ]] || usage
  [[ -f "$src/docker-compose.yml" && ! -L "$src/docker-compose.yml" ]] || die "$src/docker-compose.yml not found"
  grep -qxF "$MARKER" "$src/docker-compose.yml" && die "$src is already installer-managed"
  [[ ! -e "$home/compose.yml" ]] || die "$home already holds a deployment; use install or adopt"
  [[ $ack -eq 1 ]] || die "Updates cannot fence writers outside the Chibako container (for example a local stdio MCP server). Stop them, then re-run with --confirm-no-external-writers."

  local data="$src/data"
  if [[ -f "$src/.env" ]] && grep -qE '^CHIBAKO_DATA_VOLUME=' "$src/.env"; then
    data="$(grep -E '^CHIBAKO_DATA_VOLUME=' "$src/.env" | tail -1 | cut -d= -f2-)"
    [[ "$data" == ./* ]] && data="$src/${data#./}"
  fi
  [[ "$data" =~ $SAFE_PATH && "$data" != *..* ]] || die "unsupported data location: $data (only plain host directories are migrated)"
  [[ -f "$data/brain.db" ]] || die "$data/brain.db not found; refusing to migrate without a vault"

  local old=(docker compose --project-directory "$src" -f "$src/docker-compose.yml") cid image_id
  cid="$("${old[@]}" ps -q chibako | head -1)"
  [[ -n "$cid" ]] || die "start the source-built Chibako first so its current image can be preserved for rollback"
  image_id="$(docker inspect --format '{{.Image}}' "$cid")"

  local work; work="$(mktemp -d)"; trap "rm -rf '$work'" EXIT
  fetch release.env "$work/release.env"
  fetch docker-compose.release.yml "$work/compose.yml"
  grep -qxF "$MARKER" "$work/compose.yml" || die "downloaded Compose file is not an installer-managed file"
  local app_image updater_image version
  app_image="$(release_value "$work/release.env" CHIBAKO_IMAGE)"
  updater_image="$(release_value "$work/release.env" CHIBAKO_UPDATER_IMAGE)"
  version="$(release_value "$work/release.env" CHIBAKO_RELEASE_VERSION)"
  [[ "$app_image" =~ $IMAGE_RE ]] || die "release metadata has an unexpected application image"
  [[ "$updater_image" =~ $UPDATER_RE ]] || die "release metadata has an unexpected updater image"
  docker pull --quiet "$updater_image" >/dev/null # everything is fetched before the old stack stops
  docker pull --quiet "$app_image" >/dev/null

  # The managed deployment starts on exactly the image that is running now; the updater then moves it forward.
  local rollback; rollback="chibako-rollback:$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z')"
  docker tag "$image_id" "$rollback"
  mkdir -p "$home"
  : >"$home/.env"; chmod 600 "$home/.env"
  local key
  for key in SITE_NAME CHIBAKO_PORT CHIBAKO_TRUST_PROXY CHIBAKO_SETUP_TOKEN; do
    { grep -E "^$key=" "$src/.env" 2>/dev/null | tail -1 >>"$home/.env"; } || true
  done
  write_env_line "$home/.env" CHIBAKO_DATA_VOLUME "$data"
  printf 'CHIBAKO_IMAGE=%s\n' "$rollback" >"$home/pin.env"; chmod 600 "$home/pin.env"

  echo "Stopping the source-built Chibako (data stays in $data)..."
  "${old[@]}" down
  mkdir -p "$home/data"; prepare_channel
  if ! with_lock "$home/updater/.deploy.lock" apply_install "$work" "$app_image" "$updater_image" "$version"; then
    echo "chibako: the managed deployment did not start; restarting your source build." >&2
    docker compose -p chibako --project-directory "$home" --env-file "$home/.env" --env-file "$home/pin.env" -f "$home/compose.yml" down || true
    "${old[@]}" up -d --no-build
    die "migration aborted; your source build is running again and $data was not changed by the installer"
  fi
  docker compose -p chibako --project-directory "$home" --env-file "$home/.env" --env-file "$home/pin.env" -f "$home/compose.yml" \
    exec -T updater node /usr/local/lib/chibako-updater.mjs apply "$app_image" \
    || die "the first update did not complete; your previous image keeps serving after a rollback (see: docker logs of the updater)"
}

do_status() {
  [[ -f "$home/compose.yml" ]] || die "no installer-managed deployment found at $home"
  docker compose -p chibako --project-directory "$home" --env-file "$home/.env" --env-file "$home/pin.env" -f "$home/compose.yml" ps
  grep -E '^CHIBAKO_(IMAGE|UPDATER_IMAGE)=' "$home/pin.env"
}

do_uninstall() {
  [[ -f "$home/compose.yml" ]] || die "no installer-managed deployment found at $home"
  grep -qxF "$MARKER" "$home/compose.yml" || die "$home/compose.yml is not installer-managed; refusing to touch it"
  # Containers only: no -v, no --remove-orphans, so volumes and unrelated services are untouched.
  docker compose -p chibako --project-directory "$home" --env-file "$home/.env" --env-file "$home/pin.env" -f "$home/compose.yml" down
  local data; data="$(grep '^CHIBAKO_DATA_VOLUME=' "$home/.env" | tail -1 | cut -d= -f2-)"
  echo "Stopped. Your data ($data), backups ($home/backups), and settings ($home/.env) were kept."
  echo "To remove everything, delete $home yourself after checking you no longer need it."
}

case "$command" in
  install) do_install;;
  adopt) do_adopt "$@";;
  migrate) do_migrate "$@";;
  status) do_status;;
  uninstall) do_uninstall;;
  *) usage;;
esac
