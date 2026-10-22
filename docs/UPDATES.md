# Installing and updating Chibako

Chibako publishes a release for every merge to `main`. Each release has a
monotonic version (`<major>.<minor>.<run number>`), a scanned image pinned by
digest, and a manifest (`release.json`). Publishing a release never installs
it: a running Chibako shows **Update available vX.Y.Z** and the owner clicks
**Update**.

Supported: Linux amd64 with Docker Engine and the Compose plugin. Rootless
Docker and Docker Desktop have not been tested.

Run these commands on the Linux host as a user that can access Docker. The
script needs Bash and curl; the Docker-only setup also uses OpenSSL. Release
downloads require a published release containing `install.sh`,
`docker-compose.release.yml`, `release.env`, and `release.json`.

## How it works

```text
GitHub release ──release.json──► updater container ◄──request/status files──► Chibako app
                                      │ (Docker socket)
                                      └─ pull digest → pause writers → snapshot → switch pin →
                                         start → health gate → reopen writes  (else restore)
```

- The **updater** is a separate container (`ghcr.io/jccd-dev/chibako-updater`).
  It has no network listener and acts only on a host-owned config file the app
  cannot see. It fetches the manifest itself, accepts only the fixed image
  repository and a `sha256` digest, and runs Docker with argument vectors.
- The **app** can only drop a bounded request file (`update to 0.1.2`) and read
  a status file published read-only. A compromised app cannot choose an image,
  path, or command.
- **Docker socket warning:** the updater can control Docker, which is
  equivalent to root on the host. That is the price of one-click updates. If you
  do not accept it, keep a separately managed Compose deployment and change its
  image pin before pulling and recreating the app. Pulling an unchanged digest
  does not select a newer release.
- One operation runs at a time, guarded by `flock` on `updater/.deploy.lock`.
  Every change to the updater's state, and every recovery step, happens under
  that lock.
- **Prerequisite: no writers outside the Chibako container.** The maintenance
  marker fences the app and a local stdio MCP server from the same release, but
  nothing can fence a process from an older release (an old stdio MCP, a script
  that opens `brain.db`). Stop those before adopting or updating; adoption asks
  you to confirm this explicitly. A long-lived stdio MCP from a release with the
  fence reopens the database automatically after it was replaced or migrated.

### What an update does

1. Pulls the selected digest while the old version keeps serving.
2. Creates the maintenance marker (`data/.chibako-maintenance`), which makes
   every vault accessor (HTTP and the local stdio MCP) refuse work, and stops
   the app.
3. Takes a consistent SQLite snapshot (`VACUUM INTO`, includes the WAL), verifies
   its integrity and checksum, then switches the image pin atomically.
4. Starts the new image; its health check runs the migrations. Writes stay
   fenced until the version is healthy, so a restore can never discard newly
   saved notes.
5. Marks the operation committed, then removes the marker.

The page stays open after success so unsaved settings and note drafts are not
discarded. Save pending edits, then choose **Reload Chibako** and confirm
**Reload now**. Other open tabs also offer a reload when they detect the new
running version.

If installation fails after a snapshot is available, the updater attempts to
stop the app, move the failed database aside
(`backups/<operation>/failed/`, never deleted), restore the matching snapshot
and previous image, and start the old version. The marker is removed only
after a verified new version or a completed rollback. If the rollback itself
fails the marker stays in place across updater restarts, the status reads
"needs attention", new updates are refused, and your backup is listed in the
message. After fixing the cause, retry the rollback where it stopped:

```bash
docker exec '<updater-container>' node /usr/local/lib/chibako-updater.mjs recover
```

The updater persists its phase before each side effect. After a crash or reboot
it resumes from the recorded phase using the actual container and files.

Backups: the newest successful snapshot is kept in `backups/<operation>/`;
older successful ones are pruned when the next update commits. Quarantined
failed databases are never pruned automatically.

### Schema guard

Every release stamps the vault (`PRAGMA user_version`). A release refuses, before
writing anything, to open a vault stamped by a newer release; a downgrade is
never attempted automatically. Releases older than this feature cannot enforce
the guard, so never run an old image against a vault a newer one has opened.
Restoring is the only supported way back.

## Install (script)

```bash
curl -fsSL https://github.com/jccd-dev/chibako/releases/latest/download/install.sh | bash
```

Creates `~/chibako` (override with `CHIBAKO_HOME`; letters, digits, `. _ - /` only):
`compose.yml`, `.env` (mode 600, includes the one-time setup token), `pin.env`,
`data/`, `backups/`, `updater/`. Re-running for an installer-managed deployment
is safe: it never rewrites `.env`,
never moves the app pin (the updater owns it) and only refreshes the updater
image and managed Compose file. It refuses to overwrite a `compose.yml` it did
not write.

Reinstalling is also how you upgrade the updater itself when the status says
"the updater is out of date".

For an adopted deployment, keep its existing updater configuration and Compose
files when upgrading the companion image. Do not run the default `install`
command against an adoption directory: it writes the managed-install config.

The default port binds to `127.0.0.1:3000`. Use a reverse proxy with HTTPS for
remote access (see the [README deployment steps](../README.md#-deploy-to-your-vps-docker-compose--nginx)).
The setup token is in `$CHIBAKO_HOME/.env` (`~/chibako/.env` by default). After
creating the account, remove `CHIBAKO_SETUP_TOKEN` and recreate the app:

```bash
cd "${CHIBAKO_HOME:-$HOME/chibako}"
docker compose --env-file .env --env-file pin.env up -d chibako
```

## Install (Docker only, no script)

```bash
mkdir -p ~/chibako && cd ~/chibako
base=https://github.com/jccd-dev/chibako/releases/latest/download
curl -fsSL -o compose.yml "$base/docker-compose.release.yml"
curl -fsSL -o pin.env "$base/release.env"
printf 'CHIBAKO_HOME=%s\nCHIBAKO_DATA_VOLUME=%s/data\nCHIBAKO_SETUP_TOKEN=%s\n' "$PWD" "$PWD" "$(openssl rand -hex 32)" > .env
chmod 600 .env pin.env
docker compose --env-file .env --env-file pin.env up -d
```

Use the same `--env-file` pair for later `docker compose` commands, including
`docker compose --env-file .env --env-file pin.env ps` and
`docker compose --env-file .env --env-file pin.env down` (keeps vault data).
Use this path only for a new installation directory: the commands above create
`.env` and `pin.env`. For an existing deployment, use adoption or migration below.

## Adopt an existing deployment (one time)

Already running a prebuilt image from your own Compose file (or the repo's
`docker-compose.release.yml`)? Your data and settings stay where they are.
Requirements:

- Your Compose file takes the Chibako image from `${PIN_VAR}`, and the pin file
  defines that variable exactly once, as `ghcr.io/jccd-dev/chibako@sha256:<digest>`
  (a floating tag cannot be rolled back safely).
- Nothing outside the container writes to the vault (see the prerequisite above).

```bash
curl -fsSL https://github.com/jccd-dev/chibako/releases/latest/download/install.sh > install.sh
bash install.sh adopt --compose /srv/app/compose.yml --env-file /srv/app/.env \
  --service chibako --project myproject --data /srv/app/data \
  --pin-file /srv/app/pin.env --pin-var CHIBAKO_IMAGE --confirm-no-external-writers
```

The pin file is always passed to Compose as the last env file, so the updater's
edit wins. Before anything is written, adopt asks Compose what image the service
would run and refuses unless it is the pin. Adopt preserves your Compose and
runtime env files, writes its companion files under `$CHIBAKO_HOME/updater`, starts the updater and
runs the first update through it: your current image has no Update button, so
this one-time move to the newest release uses the same lock, backup, health
gate and automatic rollback as every later update. The app is recreated by that
update with the channel mounted, and the updater changes the selected image
line in your pin file. Afterwards, retire any automation that writes
the pin. `--prepare-only` writes the files and prints the same commands for you
to run.

Deployment tooling that also deploys the image must take the same lock
(`flock -n` on the lock file passed with `--lock-file`) or route emergency
deploys through the operator command:

```bash
docker exec '<updater-container>' node /usr/local/lib/chibako-updater.mjs apply \
  'ghcr.io/jccd-dev/chibako@sha256:<digest>'
```

It runs the same procedure (lock, snapshot, health gate, restore), refuses
foreign repositories and downgrades, and exits non-zero unless it succeeded.

## Move from a source build

A deployment built from this repository (`docker compose up -d --build`) has no
image digest to pin. `migrate` keeps your checkout, `.env` and vault untouched
and moves the running deployment onto the managed image:

```bash
curl -fsSL -o install.sh https://github.com/jccd-dev/chibako/releases/latest/download/install.sh
bash install.sh migrate --from /path/to/chibako-checkout --confirm-no-external-writers
```

The source build must be running and keep its vault in a plain host directory
(the default `./data`). Migrate pulls the new images first, tags the image that
is running now as the rollback image, stops the source stack (`down`, no `-v`),
starts the managed stack on that same image and vault, copies `SITE_NAME`,
`CHIBAKO_PORT`, `CHIBAKO_TRUST_PROXY` and `CHIBAKO_SETUP_TOKEN` from your `.env`,
and runs the first update through the updater. If the managed stack does not
start, the source stack is started again. Reverse proxies keep working because
the loopback port is unchanged.

## Uninstall

For an installer-managed deployment (including a completed source migration):

```bash
curl -fsSL https://github.com/jccd-dev/chibako/releases/latest/download/install.sh | bash -s -- uninstall
```

Use the same `CHIBAKO_HOME` and Docker user as installation. If you already
saved the script locally, `bash install.sh uninstall` is equivalent.

Stops and removes the containers only (`docker compose down`, no `-v`, no
`--remove-orphans`). Data, backups, `.env`, and `pin.env` stay on disk; delete
`$CHIBAKO_HOME` yourself when you are sure.

For Docker-only installations, run `docker compose --env-file .env --env-file
pin.env down` in the installation directory. For an adopted deployment, use
its original Compose files and the companion's recorded Compose arguments;
the installer's uninstall command does not manage custom adoption layouts.

## When something goes wrong

- Pages show "Internal error" after an update: the maintenance marker is still
  in place (status "needs attention"). Read
  `$CHIBAKO_HOME/updater/channel/out/status.json` and `docker logs` of the updater
  container; the verified snapshot is `backups/<operation>/brain.db` and any
  quarantined database is in `backups/<operation>/failed/`. Fix the cause, then
  run the updater's `recover` command (above), which finishes the rollback and
  reopens the vault only once the previous version is healthy. Deleting
  `data/.chibako-maintenance` by hand reopens writes without that check and
  leaves the updater in "needs attention"; do not do this unless you have
  restored the database yourself.
- A completed update asks you to reload: save any unsaved work first, then use
  **Reload Chibako**. It does not reload the page automatically.
- The banner never appears: Settings → Updates says why (unmanaged, or the
  updater is not responding / out of date).

## Known limits

- Writers that ignore the marker (stdio MCP or scripts from releases without
  this feature) are not fenced and can lose or corrupt data during an update.
  Stopping them first is a prerequisite, not something the updater can enforce.
- The release manifest is trusted on GitHub's TLS and the repository identity,
  and the image by digest; signatures (for example cosign) are not verified.
- GHCR packages must be public for installs and updates without registry login.
- The restored database inherits the vault directory's owner and has mode 600.
  The app entrypoint also fixes vault ownership before starting as `node`.
- The updater image embeds the Docker CLI from `docker:29.9.2-cli`. Its Compose
  plugin is built from checksum-pinned v5.6.1 source with Go 1.26.10 and
  `golang.org/x/net` v0.60.0 to fix CVE-2026-78669, reported as
  `v5.6.1-chibako.1`. Replace the rebuild with an official patched binary when available.
- Version numbers skip when a pending run is superseded; they never decrease.
  If an older failed workflow run is retried after a newer release, its release
  is published under its own tag but never becomes `latest`.

## Disposable lifecycle check

```bash
bash scripts/smoke-updates-docker.sh
```

Builds the app and updater, then exercises script and Docker-only installation,
source migration, adoption, and rollback after a failed image changes the schema.
Runs in a disposable privileged Docker daemon with its own local registry; it
never mounts the host Docker socket or publishes images. The installer uses its
existing local release-asset test boundary. The fixture runs on the host's native
architecture and bypasses only the installer's amd64 prerequisite. It does not
verify published amd64 images or GitHub release discovery.

## Release gate (manual, needs a Docker daemon and two published releases)

1. On a disposable host or user: install release N with `install.sh`; create the
   owner account, a note, and an API key.
2. Publish release N+1 (merge to `main`); wait for the banner, click **Update**.
3. Confirm: banner → progress → explicit reload offer on N+1. Save pending
   edits, choose **Reload Chibako**, and confirm **Reload now**. The note and key still work;
   `backups/<operation>/brain.db` exists;
   `docker compose --env-file .env --env-file pin.env ps` shows the new container,
   and `docker inspect` confirms its pinned image.
4. Break N+2 deliberately (failing health) and update: expect "rolled back", N+1
   serving, data identical to before, `failed/` containing the quarantined database.
5. Repeat step 1–3 through the Docker-only path, then run `install.sh` again and
   confirm `.env`, `data/`, and the pin are unchanged.
6. `bash install.sh uninstall`; confirm `data/` and `backups/` remain.
7. Adoption and recovery, on a disposable host: adopt a deployment running an
   older pinned release and confirm the first update succeeds through the
   updater; run `migrate` on a source build; force a failing rollback and confirm
   the marker stays, updates are refused, and `recover` completes it.
