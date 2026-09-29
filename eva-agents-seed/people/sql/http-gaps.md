# HR HTTP fallback gaps

Record each SQL workaround with a UTC timestamp, the documented route or
SQL-only domain, the failure class, the allowed HR table, and one concise next
action for an ERP maintainer. Never record credentials or other secrets.

- 2026-09-09T15:33:26Z — GET /hr/llm/employees/search; ERP_BASE_URL not configured (workspace has ERP_API_URL); SQL fallback: public.employees joined agent_share.hr_users. Ask ERP to configure the documented route.

Talento, RRHH invoices, absences, sick leaves, lateness, holidays, and shifts
are intentionally SQL-only because no routes are documented in the HR contract.
Payroll runs/config and company expenses/templates are documented HTTP domains;
if their route fails, record the failing route and the specific allowed table
used for the constrained workaround.
- 2026-09-10T11:56:10.424Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T11:56:24.689Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T11:57:29.357Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T11:57:39.608Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T11:57:40.949Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T11:57:56.591Z — GET /hr/llm/directory/users; HTTP 502; SQL fallback: agent_share.hr_users. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T12:00:00Z — POST /hr/llm/actions/recruitment/candidates; route failure; SQL fallback: public.recruitment_candidates. Ask ERP to add/fix the /hr/llm route.
- 2026-09-10T13:55:54Z — POST /hr/llm/actions/recruitment/candidates/:id/hire; route failure; SQL fallback: public.recruitment_candidates and public.employees. Ask ERP to add/fix the /hr/llm route.
