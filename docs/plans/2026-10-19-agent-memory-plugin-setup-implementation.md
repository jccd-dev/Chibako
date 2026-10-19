# Chibako Memory plugin setup implementation

Date: 2026-10-19
Status: repository implementation and local archives verified; not published,
installed on live clients, deployed or activated.

Companion to [the approved setup proposal](2026-10-19-agent-memory-plugin-setup-proposal.md).

## Delivered

- Three standalone version 0.2.0 packages, retaining the existing Chibako identity,
  for Codex, Claude Code and Hermes. Existing esbuild bundles the runner and SDK;
  users need Node 20+, not a checkout, tsx, web application or node_modules.
- An interactive terminal setup wizard with hidden API-key entry, a redacted
  preview, a separately approved persistent test write and opt-in activation.
  Non-interactive/agent-controlled credential entry is rejected by the workflow.
- Read-only `memory_status` through the capability and MCP factory: caller ID,
  exact scopes, contract version, enabled state and approved area, without Notes,
  other keys, finance or filesystem data.
- Private per-user/native-profile configuration, a dedicated remote MCP entry,
  stable paths shared by terminal setup and hooks, atomic writes, owned-config
  digests, config/profile locks and guarded rollback. Codex validates its rendered
  TOML with a disposable CODEX_HOME and the native CLI. Claude JSON and Hermes
  YAML preserve unrelated values; YAML formatting/comments may be normalized.
- Status, Doctor, Pause, Resume and Disconnect. Status includes last verified save
  and pending count. Resume checks connection identity/area before private reads;
  Disconnect preserves pending work and saved Notes. Native key revocation remains
  an owner action.
- State binding prevents pending content being redirected to another endpoint,
  principal or area. Old unbound pending state is preserved for owner review.
  Existing explicitly configured environment-only usage remains compatible, with
  configured profiles taking precedence and the emergency off switch preserved.
- Installed-path setup guidance and checkpoint commands, plus native hook adapters.
  Automatic writes retain the existing Notes, revision and retry protections.

The package build and installation procedure are in the
[installation guide](../../integrations/agent-memory/INSTALL.md).
`npm run build:memory-plugins` creates archives under ignored `dist/plugins/`;
no release upload or marketplace publication occurs.

## Observed evidence

- `npm test`: 296 passed, 0 failed, 0 skipped. This includes a compiled runner
  authenticating through the MCP SDK against a disposable loopback HTTP adapter,
  saving a Note and replaying the same request without duplication.
- Real PTY tests: a synthetic API key is not echoed; submission against an
  unavailable endpoint and cancellation create no profile/native config.
- Extracted archives execute from unrelated paths without node_modules; native
  manifests, hook paths, skills and Hermes callback registration are checked.
- Scope/disabled/contract checks, config preservation and external-edit rejection,
  resume identity ordering, pending binding, pause/disconnect and YAML alias
  preservation pass. Source Note/revision/replay protections remain covered.
- Typecheck, project lint and explicit lint of new scripts/adapters pass.
- Architecture boundaries and standalone MCP smoke checks pass.
- Production build passes using a dedicated build directory and disposable vault.
  It retains the existing external pnpm-lockfile warning.
- Archives contain compiled runners and the install guide, with no private profile,
  node_modules, credentials or configured MCP endpoint. Local guide links pass.

The sandbox initially denied loopback binding; the permitted full-suite run
exercised that integration successfully. Verification vaults and private-state
fixtures were temporary and cleaned up. Ignored build/package artifacts remain.

## Material limits

Actual native-client hook delivery/consent, the remote Hermes gateway and both
client routes, and Claude Code/Desktop environments still require an authorized
pilot. Hermes's missing-checkpoint gate remains coding-specific; interruption
without a stable session ID is skipped. Ordinary Claude Chat lifecycle automation
and bearer connectivity are not established by these packages.

The packages target Node 20 but were executed with Node 24. Windows and OS-keychain
integration are deferred. Local private files hold the restricted key in both the
runner and host configuration; this is disclosed in setup. A compatible Codex CLI
on PATH is required for its native TOML validation.

Successful connection, checkpoint receipts and fixture events are not proof of
live autonomous capture; status retains an explicit pending actual-host check.
Profile-save-failure rollback is implemented but lacks deterministic fault-injection
coverage. Concurrent external config editors must be closed during setup; setup
refuses observed conflicts and does not bypass native consent.

Server deployment, approved area/key provisioning and exact live targets remain
owner prerequisites. No E2E, Playwright, live configuration, real vault mutation,
gateway restart, commit, deployment or publication was performed.
