# HTTP fallback gaps

Record each SQL workaround here with the UTC timestamp, documented route,
failure class, allowed table, and concise next action for an ERP maintainer.

No SQL fallback has been used by this revised adapter yet.

- 2026-09-08T11:18:30.295Z — GET /crm/llm/directory/users; network failure; SQL fallback: agent_share.crm_users. Ask ERP to add/fix the /crm/llm route.

- 2026-09-08T11:18:40.106Z — GET /crm/llm/directory/users; network failure; SQL fallback: agent_share.crm_users. Ask ERP to add/fix the /crm/llm route.

- 2026-09-08T11:18:40.700Z — GET /crm/llm/directory/users; network failure; SQL fallback: agent_share.crm_users. Ask ERP to add/fix the /crm/llm route.

- 2026-09-08T11:20:39.933Z — POST /crm/llm/actions/leads; network failure; SQL fallback: public.leads. Ask ERP to add/fix the /crm/llm route.

- 2026-09-08T15:41:16.699Z — GET /crm/llm/directory/users; network failure; SQL fallback: agent_share.crm_users. Ask ERP to add/fix the /crm/llm route.

- 2026-09-08T15:43:46.134Z — POST /crm/llm/actions/leads; network failure; SQL fallback: public.leads. Ask ERP to add/fix the /crm/llm route.

- 2026-09-09T11:25:55.772Z — GET /crm/llm/leads/19872; network failure; SQL fallback: public.leads. Ask ERP to add/fix the /crm/llm route.

- 2026-09-09T11:36:56.208Z — GET /crm/llm/leads/999; network failure; SQL fallback: public.leads. Ask ERP to add/fix the /crm/llm route.
