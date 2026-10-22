#!/usr/bin/env bash
set -Eeuo pipefail
export DOCKER_BUILDKIT=0
mkdir -p /work/build /work/release /work/bin
trap 'echo "Lifecycle fixture failed at line $LINENO" >&2; for log in /work/install.log /work/manual.log /work/migrate.log /work/adopt.log /work/rollback.log; do [[ ! -f "$log" ]] || tail -60 "$log" | sed "/[Tt]oken/d" >&2; done' ERR
printf '#!/bin/sh\nif [ "$1" = -m ]; then echo x86_64; else /bin/uname "$@"; fi\n' > /work/bin/uname
chmod +x /work/bin/uname
# The release targets amd64; this fixture exercises native runtime behavior on either host architecture.
export PATH=/work/bin:$PATH
export CHIBAKO_RELEASE_BASE=file:///work/release
for version in 0.1.1 0.1.2 0.1.3; do
  printf 'FROM chibako-lifecycle-app:fixture\nLABEL org.opencontainers.image.version=%s\nENV CHIBAKO_VERSION=%s\n' "$version" "$version" > /work/build/Dockerfile
  if [[ "$version" == 0.1.3 ]]; then
    cat >> /work/build/Dockerfile <<'DOCKER'
HEALTHCHECK --interval=1s --timeout=1s --start-period=1s --retries=1 CMD exit 1
CMD ["node", "-e", "const db = require('better-sqlite3')('/app/data/brain.db'); db.exec('PRAGMA user_version = 99'); db.close(); require('./server.js');"]
DOCKER
  fi
  docker build -q -t "ghcr.io/jccd-dev/chibako:$version" /work/build
  docker push "ghcr.io/jccd-dev/chibako:$version" > /work/push.log 2>&1
done
docker tag chibako-lifecycle-updater:fixture ghcr.io/jccd-dev/chibako-updater:local
docker push ghcr.io/jccd-dev/chibako-updater:local >> /work/push.log 2>&1
old=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/jccd-dev/chibako:0.1.1)
new=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/jccd-dev/chibako:0.1.2)
bad=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/jccd-dev/chibako:0.1.3)
upd=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/jccd-dev/chibako-updater:local)
printf 'CHIBAKO_RELEASE_VERSION=0.1.2\nCHIBAKO_IMAGE=%s\nCHIBAKO_UPDATER_IMAGE=%s\n' "$new" "$upd" > /work/release/release.env
export CHIBAKO_HOME=/work/install CHIBAKO_PORT=3456
bash /work/install.sh > /work/install.log 2>&1
token=$(sed -n 's/^CHIBAKO_SETUP_TOKEN=//p' /work/install/.env)
curl -fsS -c /work/cookies -H 'Content-Type: application/json' -d "{\"password\":\"LifecyclePass-12345!strong\",\"setupToken\":\"$token\"}" http://127.0.0.1:3456/api/setup > /work/setup.json
curl -fsS -b /work/cookies -H 'Content-Type: application/json' -d '{"title":"Lifecycle survivor","content":"retained across adoption and migration"}' http://127.0.0.1:3456/api/notes > /work/note.json
bash /work/install.sh uninstall >> /work/install.log 2>&1
cp -a /work/install/data /work/seed

# The documented Docker-only path must create its own updater config through init.
mkdir -p /work/manual
cp /work/release/docker-compose.release.yml /work/manual/compose.yml
cp /work/release/release.env /work/manual/pin.env
cp -a /work/seed /work/manual/data
printf 'CHIBAKO_HOME=/work/manual\nCHIBAKO_PORT=3456\n' > /work/manual/.env
manual=(env -u CHIBAKO_HOME -u CHIBAKO_PORT docker compose -p chibako --project-directory /work/manual --env-file /work/manual/.env --env-file /work/manual/pin.env -f /work/manual/compose.yml)
"${manual[@]}" up -d --no-build --pull never > /work/manual.log 2>&1
ready=0
for _ in {1..60}; do
  if curl -fsS -b /work/cookies http://127.0.0.1:3456/api/notes 2>/dev/null | grep -q 'Lifecycle survivor'; then ready=1; break; fi
  sleep 1
done
(( ready ))
test -f /work/manual/updater/config.json
"${manual[@]}" down >> /work/manual.log 2>&1
printf 'DOCKER-ONLY INSTALL PASSED\n'

mkdir -p /work/source
cp -a /work/seed /work/source/data
printf 'SITE_NAME=Lifecycle Vault\nCHIBAKO_PORT=3456\nCHIBAKO_SETUP_TOKEN=%s\n' "$token" > /work/source/.env
cat > /work/source/docker-compose.yml <<YAML
services:
  chibako:
    image: chibako-lifecycle-app:fixture
    build: .
    environment:
      DATA_DIR: /app/data
    volumes:
      - ./data:/app/data
    ports:
      - '127.0.0.1:3456:3000'
YAML
docker compose --project-directory /work/source -f /work/source/docker-compose.yml up -d --no-build --pull never > /work/source-start.log 2>&1
export CHIBAKO_HOME=/work/migrated
bash /work/install.sh migrate --from /work/source --confirm-no-external-writers > /work/migrate.log 2>&1
printf 'MIGRATE BOOTSTRAP PASSED\n'
curl -fsS -b /work/cookies http://127.0.0.1:3456/api/notes | grep -q 'Lifecycle survivor'
test -n "$(find /work/migrated/backups -name brain.db -print -quit)"
test ! -e /work/source/data/.chibako-maintenance
grep -q '"phase":"succeeded"' /work/migrated/updater/state.json
bash /work/install.sh uninstall >> /work/migrate.log 2>&1
mkdir -p /work/existing
cp -a /work/seed /work/existing/data
printf 'APP_IMAGE=%s\n' "$old" > /work/existing/pin.env
cat > /work/existing/compose.yml <<'YAML'
services:
  app:
    image: ${APP_IMAGE}
    environment:
      DATA_DIR: /app/data
    volumes:
      - ./data:/app/data
    ports:
      - '127.0.0.1:3456:3000'
YAML
docker compose -p legacy --project-directory /work/existing --env-file /work/existing/pin.env -f /work/existing/compose.yml up -d --pull never > /work/adopt-start.log 2>&1
export CHIBAKO_HOME=/work/adopted
bash /work/install.sh adopt --compose /work/existing/compose.yml --service app --project legacy --data /work/existing/data --pin-file /work/existing/pin.env --pin-var APP_IMAGE --confirm-no-external-writers > /work/adopt.log 2>&1
printf 'ADOPT BOOTSTRAP PASSED\n'
curl -fsS -b /work/cookies http://127.0.0.1:3456/api/notes | grep -q 'Lifecycle survivor'
test -n "$(find /work/adopted/backups -name brain.db -print -quit)"
if docker compose -p chibako-updater -f /work/adopted/updater/updater.compose.yml exec -T updater node /usr/local/lib/chibako-updater.mjs apply "$bad" > /work/rollback.log 2>&1; then echo 'broken image unexpectedly succeeded' >&2; exit 1; fi
grep -q 'rolled_back' /work/rollback.log
curl -fsS -b /work/cookies http://127.0.0.1:3456/api/notes | grep -q 'Lifecycle survivor'
test ! -e /work/existing/data/.chibako-maintenance
failed=$(find /work/adopted/backups -path '*/failed/brain.db' -print -quit)
test -n "$failed"
docker run --rm --entrypoint node -v "$(dirname "$failed"):/vault:ro" "$upd" -e '
  require("node:fs").cpSync("/vault", "/tmp/quarantine-check", { recursive: true });
  const db = new (require("node:sqlite").DatabaseSync)("/tmp/quarantine-check/brain.db", { readOnly: true });
  if (db.prepare("PRAGMA user_version").get().user_version !== 99) process.exit(1);
  db.close();
'
printf 'REAL DOCKER INSTALL, MIGRATE, ADOPT, ROLLBACK PASSED\n'
