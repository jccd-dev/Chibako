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

Existing finance rows block initial migration eligibility, including archived
records and prior finance bookkeeping. Existing Notes do not block eligibility.
Inspection remains available to explain a blocked source or destination.

`POST /api/finance/import/inspect` accepts the raw `application/json` backup and
returns a non-cacheable `source-inspection` report. It requires an authenticated
owner session and rejects bearer credentials, including when an owner cookie is
also present. The portable capability independently rejects keyed and trusted
local agents. There is no MCP inspection, commit, or restore tool.

Capability tests use synthetic backups and disposable SQLite Vaults. Owner HTTP
checks reuse the existing disposable password-route server and verify unchanged
serialized Vault contents for successful, rejected, and malformed inspection.

The proposal preserves collection/ID identity, original relationships, text and
nested progress history. Each accepted account shows its source snapshot, signed
accepted effects, inferred opening, and cent-exact reconciled balance. Earlier
historical balances remain unverified. Pending source activity has no cash effect.
Recurring definitions remain paused. Saved/paid/collected snapshots become starting
progress, not new cash activity; goal progress needs a money-account allocation.

Review accepted, blocked, skipped and excluded counts by collection. Skipped is
zero for an initial proposal; retry handling belongs to the later migration step.
Unsupported data and individual source records can be explicitly excluded using
the review controls. Select exclusions, update the preview, acknowledge every
exclusion, and update again. Required dates/references, invalid money, allocation
conflicts and mirror divergence cannot be dismissed by acknowledgment. Resolve
source mappings in the backup or exclude affected records explicitly; dependencies
on excluded records remain blockers. A proposal is ready for approval only when
finance is empty, all blockers are settled, and every exclusion is acknowledged.

`POST /api/finance/import/inspect?preview=1` accepts
`{ "backup": <Tarsi envelope>, "exclusions": [<source path>], "acknowledged_exclusions": [<source path>] }`
and returns a non-cacheable `reconciled-preview` report. Review choices are checked
server-side against that backup; unknown paths and extra review options are rejected.
Source and exception details remain private to the owner response and client memory.
Commit requires a recoverable backup and separate owner confirmation; this panel
has no commit action. Never commit a personal backup or use it as a test fixture.
