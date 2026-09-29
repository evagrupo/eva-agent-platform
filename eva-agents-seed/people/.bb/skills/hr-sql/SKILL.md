---
name: hr-sql
description: Recover an HR operation or bridge a failed or missing HR route through constrained SQL.
---

# HR SQL recovery

Read sql/grants.hr.md first. Use SQL only after diagnosing a documented HR
HTTP 404, 4xx/5xx, timeout, network/parse failure, or for a domain explicitly
marked SQL-only because no route is documented. Load DATABASE_URL only from
this workspace's .env.hr-bootstrap and require the bb_hr role.

Resolve people before a write through agent_share.hr_users: the human gives a
login email or full name, one directory match supplies the id, zero is not
found, and several matches are shown by name and email for a choice. Never ask
for or invent a numeric user id. Never read direct users, password columns,
CRM tables, leads, call_logs, client_products, CRM comments, siniestros,
Protect policies, account, refresh_token, verification, or mailbox data.

Keep every fallback in one transaction and stay inside the grant list. The
adapter supplies the EVA actor on writes. Honor the confirmation rules: payroll
approve/mark-paid/delete-run, payroll config changes, expense/template deletes,
referral mark-paid/cancel, and leave-balance adjustments require confirmation;
single creates, updates, and approvals do not. After a successful workaround,
append one concise note to sql/http-gaps.md naming the failing route and
allowed table. Never create roles, grant privileges, connect to production, or
move payroll money.

Keep fallback mechanics internal. Return the HR record in the user's latest
language, with no SQL or transport details.
