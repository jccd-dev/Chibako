# Install automatic Chibako memory

Status: local packages are available through the package build. They have not been
published or activated on live clients. Node.js 20+ on macOS/Linux is required.
Bundles have been executed on Node 24; Node 20 execution remains a compatibility check.

## Prepare the server once

The owner deploys the bounded memory capability and privately configures
`CHIBAKO_MEMORY_FOLDER` to an approved non-root area. Create one API key per runtime
or native profile with exactly `notes:read`, `schema:read`, and `memory:write`.
The setup wizard checks those scopes through `memory_status`; a broad existing key
is rejected. It does not administer the server or issue keys.

## Get a package

Maintainers run:

```sh
npm run build:memory-plugins
```

The build produces `dist/plugins/chibako-codex-<version>.tar.gz`,
`chibako-claude-<version>.tar.gz` and `chibako-hermes-<version>.tar.gz`.
Each archive includes a compiled runner, skills and native plugin definitions.
The web application, database bindings, tsx and node_modules are not required on
the client. Building does not publish a release. End users receive an archive,
extract it to a stable directory and install through their native plugin manager.
Retain that directory while a local marketplace points to it.

| Runtime | Install the extracted package |
| --- | --- |
| Codex | `codex plugin marketplace add /absolute/path/to/extracted-codex`, then install Chibako through Plugins or `/plugins`. Review native hook trust through `/hooks`. A compatible Codex CLI on PATH is required for setup's isolated TOML validation. |
| Claude Code | Add `/absolute/path/to/extracted-claude` with `/plugin marketplace add`, then `/plugin install chibako@chibako-plugins`. Review hook consent in the selected Code environment. |
| Hermes | Install the extracted native plugin using the selected version's plugin manager, then enable/review its declared hooks through that profile's normal consent. Do not install the older shell-hook examples alongside it. Actual gateway version and local-package install support must be confirmed before activation. |

Codex hooks use manual/local marketplace installation. Hook-bearing packages are
currently ineligible for the official public plugin directory. The source-repo
marketplace still supports manual memory access; the built archive provides the
standalone automatic setup workflow. Install only one Chibako package per host;
replace/disable an old source package through the plugin manager before using its
new bundled counterpart, rather than loading both.

## Run private setup

Ask the installed `chibako-memory-setup` skill for its installed command, or run
this in your own terminal with the actual absolute extraction/install path:

```sh
node /absolute/path/to/plugin/bin/memory.mjs codex setup
```

Replace `codex` with `claude` or `hermes` as appropriate. An interactive terminal is
required. The API key is collected without echo; it is never accepted as a command
argument. Do not paste it into chat or a project file. Setup prints a redacted
preview before applying private configuration. Canceling that preview leaves the
profile and host settings unchanged. A failed configuration application attempts
to restore only the host bytes written by that setup; a concurrent edit blocks
rollback rather than overwriting it.

Setup configures a dedicated `chibako-memory` remote MCP entry in the host's
private configuration, with a private copy of the bearer key. The runner profile
contains the same credential so both use one entered key. Files are mode 0600;
runner directories are 0700. These are local private files, not an OS keychain.
The setup preview identifies their exact paths. The key appears in those files;
it is excluded from command arguments, published artifacts and diagnostics.

Default native target and private profile locations:

| Runtime | Native configuration | Runner profile root |
| --- | --- | --- |
| Codex | `$CODEX_HOME/config.toml`, default `~/.codex/config.toml` | `$CODEX_HOME/chibako-memory/codex/default` |
| Claude | `$CLAUDE_CONFIG_DIR/.claude.json`, default `~/.claude.json` | `$CLAUDE_CONFIG_DIR/chibako-memory/claude/default`, default `~/.claude/chibako-memory/claude/default` |
| Hermes | `$HERMES_HOME/config.yaml` | `$HERMES_HOME/chibako-memory/hermes/default` |

Run setup with the same native home variables as the actual host. Hermes setup
requires an explicit `HERMES_HOME` for the selected profile; no remote gateway is
guessed. Human-terminal setup and hooks deliberately use these stable per-user
paths rather than depending on environment variables available only to plugin
hooks. `--profile-dir /absolute/private/path` explicitly selects a runner profile
for controls/staging; hooks must target that same directory if an override is used.
The normal package uses the default memory profile within the selected native
host profile. Do not create an alternate memory label and assume default hooks
will discover it automatically.

Unrelated settings and hooks are preserved. Codex owns a marked TOML connection
block; its full rendered config is validated using `codex mcp get` against a
private temporary CODEX_HOME before application. Claude JSON and Hermes YAML
preserve unrelated values; Hermes YAML comments and formatting may be normalized,
as the preview warns. Existing connections with the same managed name and manual
memory hook definitions are conflicts requiring review. Setup does not silently
adopt them, erase user edits or remove Impeccable hooks.

The optional write check asks before creating one persistent `TEST Memory
connection ...` checkpoint. It verifies the exact receipt; no deletion scope is
requested for cleanup. Ordinary setup probes are read-only. After configuration,
restart/reload the selected host if its configuration requires it, review native
hook consent, then choose to enable automatic mode. The wizard does not restart
or authorize native hosts on your behalf.

## Controls

Use the same installed runner and runtime, replacing `setup` with:

| Command | Behavior |
| --- | --- |
| `status` | Local state, enabled/configured flags, last connection check, last verified save and pending count; no network |
| `doctor` | Bounded server reads, exact scopes/contract, identity/area, native connection ownership and duplicate-hook checks |
| `pause` | Stop automatic retrieval, saving and pending retries |
| `resume` | Check the native entry and original remote identity/area before enabling |
| `disconnect` | Pause, remove only the unchanged managed native connection and clear the runner credential; retain pending files and saved Notes |

Key revocation remains an explicit owner action. Disconnecting one client does
not revoke another client's key or delete vault Notes. If the native connection
was edited outside setup, disconnect pauses but refuses to overwrite that entry;
review it before retrying. Close concurrent host config editors during changes.

Status never equates installation or authentication with proven automatic capture.
`capture_verified` remains false until actual-host pilot evidence is established;
its last-save timestamp refers to a validated write receipt, not deployment or
project completion. The package does not fabricate a successful live pilot marker.

## Pending work and recovery

A checkpoint is retained privately before upload and is cleared only on a matching
receipt. Retries use the same request identity. Pausing also stops pending retries.
Changing URL, key identity or approved area must not redirect pending content.
Setup rejects changing endpoint/identity while checkpoints are pending; the runtime
also binds individual state files to endpoint, principal and approved area. Resume
checks identity/area before requesting private schema or recall.

Keep an old profile when replacing a key with a different principal, and resolve
its pending contributions before retargeting. New API keys do not inherit ownership
of old session records. Unbound pending files from the older environment-only
workflow are retained for explicit owner review; they are not automatically adopted
into the new binding. Existing environment-only hooks remain supported as a legacy
workflow; remove/disable their reviewed definitions before enabling packaged hooks.
An existing configured profile takes precedence over legacy environment settings;
`CHIBAKO_MEMORY_ENABLED=0` remains an emergency off switch.

Locks prevent concurrent operations within the same profile. A crash can leave a
lock file: confirm the owning process has stopped before removing only its stale
lock. Pending checkpoint JSON must remain intact. Package upgrades keep private
state outside the installed/versioned package; uninstalling the package does not
necessarily revoke server credentials or remove private checkpoints.

## Compatibility and pending activation

Package fixtures verify extracted archives in unrelated working directories,
private setup fixtures, scope checks, replay/binding and native callback envelopes.
Those checks do not prove a particular desktop host or remote gateway runs hooks.

- Codex CLI/desktop and Claude Code/Code Desktop need actual-host event and consent
  checks. T3 Code is a separate host check.
- Hermes native `pre_verify` only prompts for missing checkpoints on edited-code
  turns. Other workflows depend on normal agent staging. Messaging and desktop
  routes must be verified independently. Interrupt events without a stable session
  ID are skipped rather than assigned to a display name or another session.
- Compaction/interrupt hooks only flush already-staged data. They cannot recover
  unstaged work. SDK and host timeouts may leave a checkpoint pending for retry.
- Ordinary Claude Desktop Chat has no equivalent lifecycle automation established;
  scoped bearer connectivity remains a separate compatibility check.
- Windows private-storage handling and a native keychain integration are deferred.

No live installation, publication, server config, real write check or gateway
restart is performed by the repository build/tests. The exact target and concrete
configuration changes must be reviewed before activating the pilot. E2E and
Playwright remain excluded from this implementation session.
