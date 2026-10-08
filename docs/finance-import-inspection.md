# Tarsi source inspection

Open Finance > Manage > Inspect backup and select a Tarsi JSON backup, up to
8 MiB. The file is sent to the Chibako server for inspection, never saved, and
the report is cleared when the panel closes. No finance records, audit entries,
migration records, or Notes are written or automatically linked.

Inspection reports source section counts, IDs, relationships, currencies,
dates, unsupported fields, and exceptions. It is separate from the reconciled
migration preview and import commit, which are not available in this panel.

The inspector uses top-level `data` collections when `accounts` is present;
otherwise it uses the explicitly identified active profile. It compares mirrors
and reports divergence and sections outside that representation. It never merges
representations. Resolving divergent data or agreeing exclusions belongs to the
later migration preview.

Explicit calendar days are retained verbatim. Invalid dates and timestamp-to-day
ambiguity require review; metadata timestamps are displayed without mapping them
to transaction days. Unsupported currencies block progression without conversion.
A balance adjustment referencing an absent account is an exception requiring
explicit exclusion, never a reason to invent or reassign an account.

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
