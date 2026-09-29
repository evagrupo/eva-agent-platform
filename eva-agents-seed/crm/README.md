# EVA Grupo CRM & Call Center

This workspace supports CRM work for leads, clients, operators, call history,
recycling, and assignment.

## User-facing behavior

- Match the user's latest language.
- Run clear reads immediately and return the CRM result directly.
- Keep implementation details out of user replies.
- Show full lead/client contact information on an explicit lookup, including a
  status name and operator name.
- Execute clear single-record creates, updates, and comments directly.
- Ask for confirmation only for bulk reassignment, delete, pause, or other
  many-row changes.

## Local operation

Use `src/crm-actions.mjs` and `src/crm-adapter.mjs` for CRM operations. Only
`.env.crm-bootstrap` in this workspace is loaded; never commit or print it.
The endpoint contract is `src/endpoints.schema.md`, and SQL fallbacks remain
within `sql/grants.crm.md`.
