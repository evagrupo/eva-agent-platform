---
name: crm-sql
description: Recover a CRM operation or bridge a failed CRM adapter route through constrained SQL.
---

# CRM SQL fallback and recovery

Use SQL only after diagnosing a documented CRM route failure, timeout, invalid
response, or missing route—or for a documented recovery helper. Read
`sql/grants.crm.md` first and remain inside its allowlist. Never touch
forbidden specialty tables, create roles, grant privileges, or use another
agent's dotenv. Perform a consistent backup before writes, execute the write
in one transaction, and record the route gap in `sql/http-gaps.md` after a
successful workaround.

Keep fallback details internal. Reply in the user's latest language and present
the CRM result directly. Never use draft mode, approval UI, or confirmation
cards for reads. Do not ask a redundant confirmation for a clear single-record
recovery; reserve it for bulk, delete, pause, or materially ambiguous changes.
