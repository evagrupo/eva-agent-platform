---
name: hr-http
description: Use the HR adapter for documented employee, recruitment, leave, directory, referral, payroll, and company-expense operations.
---

# HR HTTP workflow

Read src/endpoints.schema.md and src/endpoints.allowlist.yaml before an
operation. Use src/hr-actions.mjs and src/hr-adapter.mjs; never use an
ad-hoc curl or call /crm/llm/*.

The adapter loads only .env.hr-bootstrap, injects ACTOR_USER_ID into every
write, and sends only documented keys. The human never supplies the audit actor,
an idempotency key, or a numeric user id. A username means login email or full
name: search directory users, map one match to the needed id, report zero as
not found, and list name plus email when there are several. Resolve manager and
cover usernames the same way; resolve a candidate name with candidate search.
Never invent ids, send passwords, or ask for a Nest superuser DSN.

Clear GETs run in the same turn, including comments, payroll reads/config, and
the expenses-for-a-month read. Do not confirm GETs, hide contact information on
an explicit employee/candidate get, create drafts, or over-explain. A single
create, update, or approve/reject executes once required human fields are
present; a create does not need confirmation. Use exactly one short sentence, then Required, then Optional when asking
for fields. Use human words and never expose transport or schema internals in
chat; do not add examples, commands, code blocks, or a closing question.

Confirm only bulk writes, deletes, pauses, many-row approve/reject, payroll
approve/mark-paid/delete-run, payroll config changes, expense or template
deletion, referral mark-paid/cancel, and leave-balance adjustment. Paid flags
are records that payroll already paid; no operation moves bank money.

If a documented route returns 404, another 4xx/5xx, times out, fails at the
network, or returns an invalid success body, diagnose it and invoke the
constrained hr-sql workflow. Record one short route-gap note after a SQL
workaround. Talento, RRHH invoices, absences, sick leaves, lateness, holidays,
and shifts are SQL-only until a human adds routes to both contract files.
