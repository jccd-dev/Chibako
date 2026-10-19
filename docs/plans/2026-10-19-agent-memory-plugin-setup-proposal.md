# Chibako Memory plugin setup

Date: 2026-10-19
Status: implemented in the repository; live activation remains pending. See the
[implementation report](2026-10-19-agent-memory-plugin-setup-implementation.md).

## Outcome

Install Chibako through the selected runtime's supported plugin mechanism, run a
short connection wizard once per runtime/profile, approve its hooks, and enable
automatic memory with a visible status. Users should not need to clone Chibako,
install its web application dependencies, edit hook JSON, or create checkpoint
payload files themselves.

This extends the existing bounded memory implementation. Chibako remains the
canonical store. Installation does not enable capture or grant new permissions.
The owner has selected preparation of all three runtimes before live activation.

## Confirmed starting point

- Root `plugin.json`, `mcp.json`, `.agents/plugins/marketplace.json` and
  `skills/chibako-memory/` already distribute a Chibako plugin. Extend that
  packaging rather than creating a competing plugin identity.
- `mcp.json` currently fixes a hosted endpoint. It is not a portable self-hosted
  connection wizard. The release needs supported private endpoint configuration.
- `scripts/agent-memory.ts` runs through tsx and repository dependencies. It
  requires four environment settings and assumes a checkout-relative guide path.
- `scripts/memory/runtime.ts` owns retrieval cadence, private pending state,
  receipts, retries, pause and continuation guards. Keep that implementation.
- `integrations/agent-memory/` contains three setup drafts and the Hermes adapter.
- `src/features/memory/` enforces restricted writes, registered ownership,
  revisions and replay identities. It has no connection-status operation.
- npm, esbuild, the MCP SDK and Zod are installed. No new dependency is needed to
  build a bundled Node runner or implement terminal setup.
- Actual Codex host execution, remote Hermes profiles/client routes and Claude
  environments are still unverified. Prior fixture checks do not establish them.

Related documents: [memory proposal](2026-10-19-automatic-agent-memory-proposal.md),
[implementation status](2026-10-19-automatic-agent-memory-implementation.md), and
[current integration guide](../../integrations/agent-memory/README.md).

## Recommended approach

Ship one versioned plugin release with a shared compiled runner and small native
manifests/adapters for Codex, Claude Code and Hermes. Generate client packages from
one source tree so runtime logic and skills cannot drift between distributions.
Start with the existing Git-backed/manual marketplace route. A hook-bearing Codex
plugin is currently ineligible for the public plugin directory; do not promise an
official-store installation. Ordinary Claude Desktop Chat remains a separate,
instruction-based connection with authentication and lifecycle limits disclosed.

Preserve existing manual memory access. Automatic mode uses only the bounded
memory tools and is explicitly enabled by setup; the existing skill's general
Note-write instructions must not be mistaken for automatic-write authority.

The first supported setup hosts are macOS and Linux with a compatible installed
Node runtime. Check the supported Node range against the bundled SDK at packaging
time. The current private-state permission checks are Unix-specific; report
Windows unsupported until a verified private-storage implementation exists.

### One-time owner prerequisite

The owner deploys the bounded capability, configures the private non-root memory
area and creates a separate key for each runtime/profile with exactly:

`notes:read`, `schema:read`, `memory:write`.

The client wizard does not administer the server, create keys using elevated
credentials, choose a new server folder, adopt existing notes or restart gateways.
Explain an unmet prerequisite with the exact next owner action.

### User setup flow

1. Install through the host's native plugin mechanism. This makes the setup skill
   and packaged runner available; automatic retrieval and capture remain off.
2. Invoke the setup skill or bundled CLI. Detect the runtime, installation root,
   writable plugin-data location and selected profile. Ask the user to select a
   target if detection is ambiguous; never guess a remote gateway/profile.
3. Collect the Chibako URL and restricted key in a local terminal credential
   prompt with echo disabled, or a verified host-native secret prompt. Never ask
   the user to paste the key into the agent chat, a command argument or a project
   file. Setup is a terminal wizard, not a new web screen.
4. Read server status, schema and a bounded briefing. Explain server-disabled,
   missing-scope, excessive-scope, incompatible-contract and unreachable states
   separately. Setup never claims to have checked scopes from tools/list alone.
5. Show a redacted setup preview: destination area returned by the server,
   runtime/profile, private files, effective read/write authority, hook events and
   compatibility gaps. Preserve unrelated client settings and existing hooks.
6. Apply the selected private client configuration through a documented host
   configuration mechanism, then let the host perform its own hook trust/consent.
   Do not bypass consent or overwrite cached installed plugin files.
7. Offer an explicit write check: show the clearly named synthetic checkpoint
   before the user chooses to create it. It remains in the approved area; do not
   grant deletion scope for cleanup. Retrieval/status checks stay read-only.
8. Enable automatic mode only after the reviewed setup passes. Verify a real new
   session and a real substantive turn before reporting capture as verified.

One entry of URL/key should supply setup for that runtime/profile. Prefer a
supported native credential reference. If the host needs its own private config
copy, the wizard manages both that copy and the runner's private profile without
printing the key. Prove the target's URL/auth override rules before implementing
its config writer; host formats are not interchangeable. If the host cannot
support this safely, report the limitation and leave that adapter disabled. No
local MCP proxy, extra memory server, daemon or auth redesign is in this release.

### Configuration and state ownership

Keep installation files immutable. Resolve bundled executables and skills from
the host's plugin root, and private state from its stable plugin-data directory
when supported. Otherwise use a documented per-user data location selected by
setup. All runtime/profile state directories are private (0700); files are 0600.

Store enabled state and connection settings per runtime/profile. Keep credentials
out of public manifests, generated releases, logs, diagnostic output and config
backups intended for sharing. A private file is the initial fallback when native
secret references are unavailable; do not add a cross-platform credential library
for the pilot.

Bind pending state to the configured endpoint and authenticated principal. A URL
or principal change must not redirect pending content to another vault or agent.
Block the switch while contributions are pending, or retain the old profile and
create a separate connection. Key replacement changes session ownership under the
current server contract; do not silently claim continuity across key identities.

Package upgrades preserve private profiles, pending checkpoints and retry IDs.
Configuration writes are atomic; roll back only changes made by setup if applying
host configuration fails. Backups containing credentials remain private. Recognize
existing manually installed memory hooks so migration does not run both copies;
show the exact removal/disable changes before applying them. Preserve Impeccable
and unrelated hook definitions.

### Small server status contract

Add `memory_status` through the existing authenticated MCP factory and owning
memory capability. Return only the caller's principal ID/scopes, supported memory
contract version, enabled/disabled state and approved area when enabled. No Note
content, other keys, credentials, finance data or server filesystem paths.

Require explicit `memory:write` to expose this information. Missing or revoked
credentials fail transport authentication. A valid memory principal can learn that
memory is disabled without writing or searching for a made-up record. The wizard
can then check exact scope equality rather than guess from the tool catalog.
REST exposure is unnecessary unless a real setup caller requires it.

### Controls

The bundled CLI implements `setup`, `status`, `doctor`, `pause`, `resume` and
`disconnect`; a small skill exposes those controls in each host using its installed
path. These are proposed interfaces, not commands available today.

- Status is local/read-only: enabled state, configured profile, last verified save,
  pending count and separately recorded connection/host-verification evidence.
- Doctor performs bounded read-only remote checks and detects duplicate hooks,
  permissions, missing Node, unsupported events and version mismatch. It never
  silently changes setup or claims success from a connection alone.
- Pause stops retrieval, capture and retries. Resume verifies the bound connection
  before allowing retained pending checkpoints to retry.
- Disconnect disables the selected profile and removes only plugin-managed client
  connection references/credentials. Pending files are retained and reported;
  saved vault Notes are untouched. Key revocation remains an explicit owner action.

## Implementation sequence and affected owners

| Step | Owning files/areas | Observable result |
| --- | --- | --- |
| 1. Prove packaging contracts | Existing manifests/marketplace, official schemas, selected installed host versions | Supported package layout, URL/auth configuration and hook consent documented per host; unsupported hosts identified |
| 2. Build standalone runtime | `scripts/agent-memory.ts`, `scripts/memory/`, Hermes adapter, npm build scripts | Bundled Node artifacts run from an unrelated directory with no checkout, tsx, Next or native SQLite dependency |
| 3. Add read-only status | `src/features/memory/`, `src/mcp/create-server.ts` | Setup distinguishes authentication, exact scopes, disabled server and contract compatibility without writes |
| 4. Implement private setup and controls | A small setup module beside the runtime, installed setup/control skill | One terminal wizard configures one selected profile atomically; pause and disconnect preserve pending work |
| 5. Package all three clients | Existing root plugin plus generated Claude/Hermes manifests, hook declarations and release assets | Each supported client installs the same runner version and resolves installed paths; all remain disabled initially |
| 6. Verify, then document | Existing automatic-memory tests, release checks, integration guide and relevant install documentation | Checkout-independent fixtures pass; exact live config diffs are ready for owner review |

Do not relocate Notes persistence or change the memory mutation contract for
packaging. Reuse existing schemas and runtime tests. Bundle the Hermes adapter as
well; its current subprocess command must stop importing tsx or pointing at source
TypeScript. Replace checkout-relative references in injected guidance with installed
skill/runner instructions, so an agent can stage without manufacturing files by
hand. Pending format changes, if needed for binding/status, must load existing
files without changing their stored request identity or dropping contributions.

## Verification and completion

Test decision for implementation: extend existing capability/protocol/runtime
coverage and add package/setup integration checks for the uncovered boundaries.
Main risks are a successful-looking installation with inactive hooks, leaked
credentials, duplicate capture and pending work sent to the wrong connection.

Required evidence:

- Extract each release into a temporary directory, run it from an unrelated cwd
  with no repository node_modules, and exercise startup, staging and retry. Check
  manifests reference bundled files and the release contains no private config.
- Verify status with valid, missing, revoked, excessive and insufficient scopes;
  verify disabled/older server handling and portable MCP/stdio boundaries.
- Use private temporary host fixtures to test setup cancellation, reruns, atomic
  writes, rollback, unrelated settings, duplicate hooks and masked credentials.
- Prove pause prevents I/O/retries, reconnect cannot redirect pending work,
  upgrades retain pending IDs, and disconnect retains unsaved contributions.
- Retain existing rejection, revision-conflict, receipt and retry tests. Perform
  focused typecheck/lint, full Node tests and stdio verification for code changes;
  build the server in an isolated vault/build channel when integration requires it.
- No E2E or Playwright in this session. Later authorized native-host checks prove
  actual event delivery, consent and capture; exercise Hermes messaging and desktop
  routes independently. Show "installed", "connected" and "capture verified" as
  distinct states rather than one green success label.

Package fixtures are sufficient for packaging correctness; they cannot establish
real autonomous summary quality, token overhead, event support or host execution.
No live settings, production deployment, gateway restart or publication occurs
until exact targets and reviewable changes are authorized.

## Alternatives and remaining decisions

- **Recommended:** extend the existing plugin with a compiled runner and native
  adapter packages, distributed through supported manual/Git-backed mechanisms.
- A standalone installer alone saves packaging work but still leaves users
  maintaining separate skills/hooks and updates. It is a fallback for a host
  without suitable plugin support.
- A local MCP proxy could centralize credentials but introduces another process
  and failure boundary. Defer it unless a proven host limitation requires it.
- Official public-directory publishing, OAuth, Windows, automatic key issuance,
  extra extraction models and reliable capture on currently unsupported surfaces
  are separate work, not requirements of easy setup.

No additional product decision blocks review of this plan. Exact live hosts,
remote gateway profiles, release distribution details and platform-specific
credential mechanisms must be established before their implementation or activation
can be called complete. Hermes non-coding capture and ordinary Claude Chat retain
the existing limitations until evidence establishes a supported solution.

## Source checks

Checked 2026-10-19:

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins):
  portable manifests, bundled hooks, installed/data paths and manual-install/public
  directory restrictions. Installing does not imply trusting hooks.
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference):
  native component declarations and installed root/data path handling.
- [Hermes plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins):
  native plugin registration and environment-secret requirements. Installed remote
  gateway compatibility still needs verification.
