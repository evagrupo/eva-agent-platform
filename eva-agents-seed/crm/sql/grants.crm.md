# CRM SQL allowlist (documentation only)

This document describes the intended `bb_crm` database boundary. It does not
run `GRANT` or modify production. SQL fallbacks must remain inside this list.

| Relation | Intended privilege | Notes |
|---|---|---|
| `public.leads` | SELECT, INSERT, UPDATE | Lead read/create/update and logical rollback; no DELETE. |
| `public.leads_history` | SELECT, INSERT | Lead history; TODO live-check exact writer use. |
| `public.lead_agent_actions` | SELECT, INSERT | Agent action ledger; TODO live-check. |
| `public.lead_coverage` | SELECT, UPDATE | Assignment coverage; TODO live-check. |
| `public.lead_job_runs` | SELECT | Recycling/job visibility; TODO live-check. |
| `public.lead_ops_config` | SELECT | Operational configuration; TODO live-check. |
| `public.leads_assignment_config` | SELECT | Assignment policy; TODO live-check. |
| `public.leads_assignment_rules` | SELECT | Assignment advisory input; TODO live-check. |
| `public.leads_assignment_rules_exclude_companies` | SELECT | Assignment advisory input; TODO live-check. |
| `public.leads_operator_daily_settings` | SELECT, UPDATE | Operator availability; TODO live-check. |
| `public.leads_operator_groups` | SELECT | Operator grouping; TODO live-check. |
| `public.leads_operator_groups_operators` | SELECT, INSERT, UPDATE | Assignment membership; no SQL DELETE; TODO live-check and require confirmation. |
| `public.clients` | SELECT, INSERT, UPDATE | Client CRM fallback; no SQL DELETE. |
| `public.client_products` | SELECT, INSERT, UPDATE | Client product CRM fallback; TODO live-check. |
| `public.client_external_accounts` | SELECT | External-account lookup only; TODO live-check. |
| `public.companies` | SELECT | Company directory. |
| `public.comments` | SELECT, INSERT | Lead comments. |
| `public.call_logs` | SELECT, INSERT, UPDATE | Call history; never fetch recording URLs. |
| `public.call_review_flags` | SELECT, INSERT, UPDATE | Call quality flags; TODO live-check. |
| `public.calls_trigger` | SELECT, INSERT, UPDATE | Call-plan triggers; TODO live-check. |
| `public.activity_events` | SELECT, INSERT | CRM activity feed; TODO live-check. |
| `public.appointment_requests` | SELECT, INSERT, UPDATE | CRM appointments; TODO live-check. |
| `public.chat_conversation` | SELECT | CRM conversation context. |
| `public.chat_conversation_participant` | SELECT | CRM conversation context. |
| `public.chat_message` | SELECT, INSERT | CRM messages only; bot reply remains its documented HTTP route. |
| `public.chat_message_reaction` | SELECT, INSERT, UPDATE | No SQL DELETE; TODO live-check and require confirmation. |
| `public.chat_channel_creator` | SELECT | CRM channel metadata; TODO live-check. |
| `public.notification` | SELECT, INSERT, UPDATE | CRM notifications; TODO live-check. |
| `public.telephony_config` | SELECT | Telephony lookup only. |
| `public.telephony_extension_import_runs` | SELECT | Import-run visibility; TODO live-check. |
| `public.catalogs` | SELECT | Catalogs are always read-only. |
| `agent_share.crm_users` | SELECT | Use when present for user lookup; never read password columns. |

Forbidden regardless of transport: `employees`, `employee_documents`,
`recruitment_*`, `referrals`, `leave_*`, `absences`, `sick_leaves`,
`lateness`, `holidays`, `*_shift_config`, `talento_*`, `rrhh_invoices`,
`account`, `refresh_token`, and `verification`.
