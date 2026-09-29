# HR SQL allowlist (documentation only)

This document records the intended bb_hr database boundary. It does not run
CREATE ROLE, GRANT, or any other production change. SQL fallbacks and SQL-only
HR domains must remain inside this list.

| object | privilege |
|---|---|
| employees | SELECT, INSERT, UPDATE, DELETE |
| employee_documents | SELECT, INSERT, UPDATE, DELETE |
| recruitment_candidates | SELECT, INSERT, UPDATE, DELETE |
| recruitment_candidate_documents | SELECT, INSERT, UPDATE, DELETE |
| referrals | SELECT, INSERT, UPDATE, DELETE |
| leaves_requests | SELECT, INSERT, UPDATE, DELETE |
| leaves_balance_adjustments | SELECT, INSERT, UPDATE, DELETE |
| leaves_absences | SELECT, INSERT, UPDATE, DELETE |
| leaves_sick_leaves | SELECT, INSERT, UPDATE, DELETE |
| leaves_lateness | SELECT, INSERT, UPDATE, DELETE |
| leaves_holidays | SELECT, INSERT, UPDATE, DELETE |
| leaves_user_shift_configs | SELECT, INSERT, UPDATE, DELETE |
| leaves_role_shift_configs | SELECT, INSERT, UPDATE, DELETE |
| rrhh_invoices | SELECT, INSERT, UPDATE, DELETE |
| payroll_runs | SELECT, INSERT, UPDATE, DELETE |
| payroll_entries | SELECT, INSERT, UPDATE, DELETE |
| payroll_config | SELECT, INSERT, UPDATE, DELETE |
| expense_entries | SELECT, INSERT, UPDATE, DELETE |
| expense_templates | SELECT, INSERT, UPDATE, DELETE |
| talento_courses | SELECT, INSERT, UPDATE, DELETE |
| talento_modules | SELECT, INSERT, UPDATE, DELETE |
| talento_folders | SELECT, INSERT, UPDATE, DELETE |
| talento_docs | SELECT, INSERT, UPDATE, DELETE |
| talento_lessons | SELECT, INSERT, UPDATE, DELETE |
| talento_assignments | SELECT, INSERT, UPDATE, DELETE |
| talento_assignment_rules | SELECT, INSERT, UPDATE, DELETE |
| talento_enrollments | SELECT, INSERT, UPDATE, DELETE |
| talento_lesson_progress | SELECT, INSERT, UPDATE, DELETE |
| talento_quizzes | SELECT, INSERT, UPDATE, DELETE |
| talento_quiz_attempts | SELECT, INSERT, UPDATE, DELETE |
| talento_scorm_packages | SELECT, INSERT, UPDATE, DELETE |
| talento_scorm_attempts | SELECT, INSERT, UPDATE, DELETE |
| catalogs | SELECT |
| catalog_types | SELECT |
| user_supervisors | SELECT |
| agent_share.hr_users | SELECT |

There are no HTTP routes yet for Talento, RRHH invoices, absences, sick
leaves, lateness, holidays, or shifts. Those domains remain SQL-only until a
human adds routes to src/endpoints.schema.md and
src/endpoints.allowlist.yaml. Payroll runs/config and company
expenses/templates have documented HTTP routes.

Forbidden regardless of transport: leads, call_logs, client_products,
CRM comments, siniestros, Protect policies, account, refresh_token,
verification, mailbox tables, direct users access, password columns,
CREATE ROLE, and GRANT.
