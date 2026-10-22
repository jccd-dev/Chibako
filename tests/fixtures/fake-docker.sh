#!/usr/bin/env bash
# Test double for the docker CLI. Models one compose service whose running image
# follows the pin env-file, plus knobs under $FAKE: fail-pull, unhealthy (ref),
# migrate-on-up (ref; mutates $FAKE_DB like a migration), fail-up (ref), resolved (ref
# that `compose config` reports instead of the pin), crash-on (up | stop:N).
set -u
: "${FAKE:?}"
pinvar="${FAKE_PIN_VAR:-CHIBAKO_IMAGE}"
echo "$*" >>"$FAKE/log"

version_of() { awk -v r="$1" '$1==r {print $2}' "$FAKE/versions" 2>/dev/null | head -1; }
running() { cat "$FAKE/running" 2>/dev/null || true; }
crash() { kill -9 "$PPID"; exit 137; }

case "${1:-}" in
  pull)
    echo "pull-pin $(grep "^${pinvar}=" "$FAKE_PIN_FILE" | cut -d= -f2-)" >>"$FAKE/log"
    [[ -e "$FAKE/fail-pull" ]] && exit 1
    exit 0 ;;
  tag) exit 0 ;;
  image)
    fmt="$4"; ref="$5"
    if [[ "$fmt" == *Labels* ]]; then version_of "$ref"; else [[ "$ref" == img:* && "$ref" == *@* ]] && echo "${ref#img:}"; fi
    exit 0 ;;
  inspect)
    fmt="$3"; cur="$(running)"
    if [[ "$fmt" == *'{{.Image}}'* ]]; then echo "img:${cur}|$(version_of "$cur")"; exit 0; fi
    state=running; health=healthy
    [[ -e "$FAKE/stopped" ]] && { state=exited; health=none; }
    [[ "$(cat "$FAKE/unhealthy" 2>/dev/null)" == "$cur" ]] && health=unhealthy
    echo "${cur}|${state}|${health}"; exit 0 ;;
  compose)
    shift
    envfiles=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p|--project-directory|-f) shift 2 ;;
        --env-file) envfiles+=("$2"); shift 2 ;;
        *) break ;;
      esac
    done
    sub="$1"
    pin=""
    for f in "${envfiles[@]:-}"; do [[ -f "$f" ]] || continue; v="$(grep "^${pinvar}=" "$f" | tail -1 | cut -d= -f2-)"; [[ -n "$v" ]] && pin="$v"; done
    case "$sub" in
      config)
        [[ -e "$FAKE/resolved" ]] && pin="$(cat "$FAKE/resolved")"
        if [[ "${2:-}" == "--images" ]]; then echo "$pin"; else printf '{"services":{"%s":{"image":"%s"}}}\n' "${FAKE_SERVICE:-chibako}" "$pin"; fi
        exit 0 ;;
      exec) exit 0 ;;
      ps) [[ -e "$FAKE/exists" ]] && echo cid1; exit 0 ;;
      stop)
        n=$(( $(cat "$FAKE/count-stop" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$FAKE/count-stop"
        [[ "$(cat "$FAKE/crash-on" 2>/dev/null)" == "stop:$n" ]] && crash
        touch "$FAKE/stopped"; exit 0 ;;
      up)
        [[ "$(cat "$FAKE/crash-on" 2>/dev/null)" == "up" ]] && crash
        echo "up-pin $pin" >>"$FAKE/log"
        [[ -n "$pin" && "$(cat "$FAKE/fail-up" 2>/dev/null)" == "$pin" ]] && exit 1
        echo "$pin" >"$FAKE/running"; touch "$FAKE/exists"; rm -f "$FAKE/stopped"
        if [[ "$(cat "$FAKE/migrate-on-up" 2>/dev/null)" == "$pin" ]]; then
          node - <<'JS'
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.FAKE_DB);
db.exec("INSERT INTO notes VALUES(99,'written-by-new-image'); PRAGMA user_version=2");
db.close();
JS
        fi
        exit 0 ;;
    esac ;;
esac
exit 0
