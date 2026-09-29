# EVA Grupo HR

HR workspace for shadow analysis of team productivity, load, and capacity.

## Local operation

- Run chat actions through src/hr-actions.mjs and src/hr-adapter.mjs with an
  action name and JSON input.
- src/endpoints.schema.md is the verbatim /hr/llm contract and
  src/endpoints.allowlist.yaml is its route index. Payroll runs/config and
  company expenses/templates use the documented HR routes.
- SQL recovery is limited to sql/grants.hr.md; route gaps are recorded in
  sql/http-gaps.md.
- Talento, RRHH invoices, absences, sick leaves, lateness, holidays, and shifts
  remain SQL-only until routes are added to the contract.
- The adapter resolves human usernames through the directory, injects the EVA
  actor, and executes clear reads and single creates/updates directly. Payroll
  and referral paid flags never move money.
- No Nest implementation, role creation, privilege grants, production access,
  CRM routes, or CRM tables are in scope.

## Environment variable names

Only .env.hr-bootstrap in this workspace is loaded. It may contain these names
(values are never documented or printed):

- DATABASE_URL (must use the bb_hr role)
- ERP_BASE_URL (the ERP origin used by CRM)
- X_ERP_API_KEY (the Nest key sent with the X-ERP-Key header)
- ACTOR_USER_ID (the EVA agent actor)

Never commit any .env* file.
