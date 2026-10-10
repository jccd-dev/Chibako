# Tarsi source inspection and migration preview

Open Finance > Manage > Inspect backup and select a Tarsi JSON backup, up to
8 MiB. The file is sent to the Chibako server for inspection, never saved, and
the report is cleared when the panel closes. No finance records, audit entries,
migration records, or Notes are written or automatically linked.

Inspection reports source section counts, IDs, relationships, currencies,
dates, unsupported fields, and exceptions. Choose **Preview migration** after
inspection to review the reconciled proposal. Preview also writes nothing; import
commit is a separate later step.

The inspector uses top-level `data` collections when `accounts` is present;
otherwise it uses the explicitly identified active profile. It compares mirrors
and reports divergence and sections outside that representation. It never merges
representations. Divergence remains a blocker until the source is resolved.

Explicit calendar days are retained verbatim. Invalid dates and timestamp-to-day
ambiguity require review; metadata timestamps are displayed without mapping them
to transaction days. Unsupported currencies block progression without conversion.
A balance adjustment referencing an absent account is an exception requiring
explicit exclusion, never a reason to invent or reassign an account. Preview
automatically excludes that adjustment and requires owner acknowledgment.

Existing finance rows block a new migration, including archived records and
prior finance bookkeeping. Existing Notes do not block eligibility. A source
that uniquely matches a completed migration remains eligible as a retry; an
unrelated history cannot be merged into populated finance. Inspection remains
available to explain a blocked source or destination.

`POST /api/finance/import/inspect` accepts the raw `application/json` backup and
returns a non-cacheable `source-inspection` report. It requires an authenticated
owner session and rejects bearer credentials, including when an owner cookie is
also present. The portable capability independently rejects keyed and trusted
local agents. There is no MCP inspection, backup, commit, or restore tool.

Capability tests use synthetic backups and disposable SQLite Vaults. Owner HTTP
checks reuse the existing disposable password-route server and verify unchanged
serialized Vault contents for successful, rejected, and malformed inspection.

The proposal preserves collection/ID identity, original relationships, text and
nested progress history. Each accepted account shows its source snapshot, signed
accepted effects, inferred opening, and cent-exact reconciled balance. Earlier
historical balances remain unverified. Pending source activity has no cash effect.
Recurring definitions remain paused. Saved/paid/collected snapshots become starting
progress, not new cash activity; goal progress needs a money-account allocation.

Review accepted, blocked, skipped, conflicted and excluded counts by collection.
An unchanged imported identity is skipped. A changed identity shows the original
and current source and requires explicit acknowledgment to retain the existing
Chibako record. Retry never reapplies opening-balance reconciliation to completed
accounts. Newly added identities can be imported in the same migration.
Unsupported data and individual source records can be explicitly excluded using
the review controls. Select exclusions, update the preview, acknowledge every
exclusion, and update again. Required dates/references, invalid money, allocation
conflicts and mirror divergence cannot be dismissed by acknowledgment. Resolve
source mappings in the backup or exclude affected records explicitly; dependencies
on excluded records remain blockers. A proposal is ready for approval only when
the destination is empty or the source matches a prior migration, all blockers
are settled, every exclusion is acknowledged, and every conflict is reviewed.

`POST /api/finance/import/inspect?preview=1` accepts
`{ "backup": <Tarsi envelope>, "exclusions": [<source path>], "acknowledged_exclusions": [<source path>], "acknowledged_conflicts": [<collection/source-ID key>] }`
and returns a non-cacheable `reconciled-preview` report. Review choices are checked
server-side against that backup; unknown paths and extra review options are rejected.
Source and exception details remain private to the owner response and client memory.
The backend commit contract is available for the owner workflow to call:

- `POST /api/finance/import/backup` creates and verifies a private SQLite Vault
  snapshot. It returns `{ id, sha256, size_bytes, created_at, verified }`.
- `GET /api/finance/import/backup/{id}` downloads that verified SQLite file.
- `POST /api/finance/import/recovery/verify` accepts `{ request_id, backup_id }`.
  It restores a verified backup copy into a server-created temporary Vault,
  checks SQLite integrity and compares the complete Notes/finance snapshot, then
  returns `integrity_check: "ok"`, `snapshot_matches: true`, per-table row counts,
  and whether the live Vault differs from that backup. It saves an owner-only
  retry record beside the private backup and does not change the live Vault. If the live Vault changed, those
  later Notes and finance changes must be reconciled before any offline restore.
- `POST /api/finance/import/commit` accepts `{ request_id, backup_id,
  proposal_hash, backup, exclusions?, acknowledged_exclusions?, acknowledged_conflicts?,
  final_confirmation: true }`. `proposal_hash` comes from the preview response.
  The server rechecks Vault eligibility, rebuilds the proposal from the supplied
  source and review choices, and requires the backup to still match Notes and
  finance data before committing.

The commit response contains `migration_id`, source and proposal hashes, counts
for imported/skipped/conflicted/excluded source records, per-record outcomes and reasons,
reconciled balances, the source/target identities and paused state of imported
schedules, starting progress with source/target identities for goals and
obligations, relationship-preservation entries, and acknowledged exclusions.
Each relationship entry identifies the source record/path and referenced source
record, includes a native referenced-record ID when one exists, and states that
the original relationship remains in private `source_json` metadata when Finance
has no matching link field or capability. Such entries do not imply a live Finance
link. Empty optional due, target, end, and recurring-due dates are stored as null;
nonempty optional dates must be valid calendar days. Nested contribution, borrowing,
payment, advance, collection, and mutual-offset rows each receive a private
skipped outcome that links back to the parent source ID and explains that
starting progress is preserved without replaying historical cash. Explicitly
excluded non-object array values also receive outcomes using their source path
and a safe index-based identity. Commit is owner-session-only,
uses `request_id` for idempotent request retries and stable collection/source IDs
for source retries, and atomically writes finance rows, migration outcomes,
request bookkeeping and audit. Repeated source identities are never overwritten;
new identities extend the same migration. Notes are never changed and
finance-to-Note links are not created. Stale proposals, changed Vault data,
unacknowledged exclusions or conflicts, and unrelated histories in populated
finance are rejected. Backup creation,
download and commit reject bearer-authenticated requests, including trusted-local
MCP at the capability boundary. `GET /api/finance/import` and MCP
`list_finance_imports` require `finance:read` and return paginated compact counts.
Set `include_details=true` to explicitly request private import results and
retained source rows. No MCP import commit or restore tool is exposed. Backup
verification is an actual disposable-Vault restore, not a read-only open of the
backup file. No in-app live restore is exposed. An offline restore must first
create a current backup, compare current Notes and finance data with the recovery
backup, and reconcile later changes; never overwrite the live Vault blindly.
Recovery verification detects changes across all SQLite tables, including
settings, credentials and observation data, because offline restoration replaces
the whole database. It reports only whether later changes exist, never credential
values.

Never commit a personal backup or use it as a test fixture.
