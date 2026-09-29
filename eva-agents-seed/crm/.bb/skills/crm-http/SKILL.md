---
name: crm-http
description: Use the CRM adapter for direct CRM reads and clear single-record actions.
---

# CRM HTTP workflow

Read `src/endpoints.schema.md` before adding or calling an operation. Use
`src/crm-actions.mjs` and `src/crm-adapter.mjs`, not ad-hoc requests. Send only
documented query/body keys. Resolve user, company, status, and document-type
IDs through documented directory/search routes before using them.

For a clear read, run the adapter immediately in the same turn. Never create a
confirmation card, draft, approval request, or button for a read. For a clear
single-record create, update, or comment, execute it directly; ask only when
required data is absent or the scope is materially ambiguous. Confirmation is
reserved for bulk reassignment, delete, pause, or other many-row changes.

In the user reply, match the user's latest language and use plain CRM language.
Do not expose technical transport details. An explicit lead/client lookup must
show name, email, phone, status name, operator name (or “Unassigned”), and
interest/campaign/timestamps when available. Resolve an operator ID to a name
before replying; never show only the raw ID.

On a documented route failure, use `crm-sql` only for an allowed CRM-table
fallback and record the gap internally.
