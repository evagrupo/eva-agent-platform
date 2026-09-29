# CRM `/crm/llm` endpoint schemas

Source: `erp-backend/src/apps/llm/` (Zod DTOs + service return objects), as of 2026-09-08.  
**If Nest changes, update this file — do not invent fields.**  
CRM agent copies this to `src/endpoints.schema.md`. Adapter may only send keys listed here.

HR `/hr/llm/*` does not exist yet. Do not invent HR HTTP schemas.

---

## Envelope (every route except noted)

| | |
|---|---|
| Auth | Header `X-ERP-Key: <from this agent .env>` |
| Success body | **YAML** (`YamlSerializationInterceptor`). Parse YAML → object. Exception: `POST /crm/llm/chat/bot-reply` is JSON. |
| Errors | HTTP 400 validation, 401 missing/wrong key, 403 actor not admin (writes), 404 missing row. Error body is Nest JSON/YAML — not the success shapes below. |
| Writes | JSON body. Always `actor_user_id` = real `users.id` of the human in Mensajes. Never invent. `confirmed: true` only after the human confirmed in a later turn. |

`?` = optional. Types: `int`, `string`, `bool`, `date` = `YYYY-MM-DD`, `datetime` = ISO-8601.

---

## Create lead — `POST /crm/llm/actions/leads`

Omit optional keys if unknown. Do not invent values.

- `actor_user_id` — required
- `name` — required
- `email` — required
- `phone` — required
- `user_id` — optional (assigned operator)
- `company_id` — optional
- `interest` — optional
- `campaign` — optional
- `idempotency_key` — optional

## Create client — `POST /crm/llm/actions/clients`

Omit optional keys if unknown. Do not invent values.

- `actor_user_id` — required
- `email` — required
- `firstName` — required
- `lastName1` — required
- `documentType` — required
- `documentNumber` — required
- `lastName2` — optional
- `phone` — optional
- `leadId` — optional
- `sourceCompanyId` — optional
- `address` — optional
- `postalCode` — optional
- `locality` — optional
- `province` — optional
- `idempotency_key` — optional

---

## Shared: `LeadSummary`

Returned by get-lead / search items / client-linked lead.

```
id: int
name: string
email: string
phone: string
birthdate: string | null
status: object | null          # catalog row as formatted by lead presenter
operator: { id, fullName, email } | null
company: object | null
service: object | null
campaign: string | null
interest: string | null
hotness: unknown | null
schedule: string | null
lastCalledAt: string | null
callCount: int | null
isDuplicated: bool
isActive: bool
additionalInfo: unknown | null
reason: unknown | null
createdAt: string | null
updatedAt: string | null
```

---

## Leads (read)

### `GET /crm/llm/leads/search`

Query:

| key | req | notes |
|---|---|---|
| `q` | one of q **or** `user_id` | min 2, max 80; name/email/phone |
| `user_id` | one of q **or** user_id | assignee `users.id` |
| `limit` | ? | default 10, max 100 |
| `status_id` | ? | catalog id |
| `company_id` | ? | |
| `campaign` | ? | |
| `interest` | ? | |
| `created_at__gte` | ? | string |
| `created_at__lte` | ? | |
| `source` | ? | default CRM list `seguros` |

Returns:

```
query: string | null
assigneeUserId: int | null
count: int
totalMatching: int
truncated: bool
leads: LeadSummary[]
answer: string                 # instruction: report these; do not invent
```

### `GET /crm/llm/leads/stalled`

Query: `user_id?`, `company_id?`, `limit?` (default 200, max 500).

Returns:

```
count, overdue, stalled: int
window: { planDate, staleDays }
scope: "filtered" | "all"
leads:
  - leadId, name, phone
    status: { id, name } | null
    reason: "overdue_schedule" | "stalled"
    recycled: bool
    schedule: string | null
    openPath: string
    operator: { id, name, email } | null
answer: string
```

### `GET /crm/llm/leads/:id`

Path `id` int. Returns `LeadSummary`. 404 if missing.

### `GET /crm/llm/leads/:id/comments`

Query `limit?` default 20 max 50. Newest first. Shape = formatted comments from lead presenter (`id`, `content`, author, timestamps — do not add recording URLs). 404 if lead missing.

### `GET /crm/llm/leads/:id/call-history`

Query `limit?` default 20 max 50. Newest first. **No recording URLs.** Includes `hasRecording` flag. 404 if lead missing.

---

## Clients (read)

### `GET /crm/llm/clients/search`

Query: `q` required min 2 max 80; `limit?` default 10 max 25. Active clients only.

Returns:

```
query: string
count: int
totalMatching: int
clients:
  - id, fullName, documentNumber, phone, email
    isCompany, companyName, productsCount, productTypes[]
    sourceCompanyId, partnerCompanyId
```

### `GET /crm/llm/clients/lookup`

Query: **exactly one** of `document_number` | `email` | `phone`.

Returns `{ found: bool, count: 0|1, client: { id, fullName, documentNumber, phone, email } | null }`.

### `GET /crm/llm/clients/opportunities`

Query: `category?` = `renewal` \| `upsell`; `limit?` default 100 max 500. Read-only.

Returns a list payload from `ClientsOpportunitiesLlmService` (`ok`/items/category counts + `answer`). Do not mutate from this route.

### `GET /crm/llm/clients/:id`

Returns client snapshot: identity + address + **masked** `billingIban` + `productsCount` / `productTypes` / `totalPrima` + `products: ProductLlm[]`. 404 if missing.

### `GET /crm/llm/clients/:id/products`

Query `type?` = `SEGUROS` \| `PROTECT` \| `MOVIL` \| `SALUD`.

Returns `{ clientId, count, typeFilter, products: ProductLlm[] }`.

`ProductLlm` (no raw billing blob): `id`, `productId`, `type`, `productName`, `label`, `status`, `startDate`, `endDate`, `commitmentEndDate`, `sourceAppCode`, `partnerCompanyId`, `certificateStatus`, `certificateUrl`, `signedCertificateUrl`, `hasSignedCertificate`, `createdAt`, `updatedAt`, `details` (type-specific, e.g. policyNumber), `billing: { ibanMasked, paymentMethod?, holderName? } | null`.

### `GET /crm/llm/clients/:id/lead`

Returns `LeadSummary` **or** `{ found: false }` when `clients.leadId` is null. 404 if client missing.

---

## Directory

### `GET /crm/llm/directory/users`

Query: `q` required min 2; `limit?` default 10 max 25. Active users; no AI bots.

Returns `{ query, count, users: [{ id, firstName, lastName, email, fullName, isActive, roleId, roleName, roleKind, isSupervisorRole, supervisorId }] }`.

Use `id` as `user_id` / `userIds` / `actor_user_id` only after the human picked a row. Never invent ids.

### `GET /crm/llm/directory/companies`

Same query shape. Returns matching active companies (`id`, `name`, `displayName`, `slug`, …). Use `id` as `company_id`.

### `GET /crm/llm/directory/document-types`

Query: `q?`, `limit?` default 50 max 100. Returns catalog `DOCUMENT_TYPES`. Use `id` as `documentType` on create client.

---

## Dashboard + operators

Time-range query (overview, conversion-pipeline, leads-analytics, kpis):  
`timeRange?` = `all` \| `today` \| `week` \| `month` (default) \| `year` \| `custom`.  
If `custom`: `startDate` + `endDate` required (`YYYY-MM-DD`). `company_id?`.

| method | path | extra query | returns (summary) |
|---|---|---|---|
| GET | `/crm/llm/dashboard/overview` | time-range | leads + clients created in range |
| GET | `/crm/llm/dashboard/conversion-pipeline` | time-range | funnel stages + conversionRate |
| GET | `/crm/llm/dashboard/leads-analytics` | time-range | KPIs + breakdowns |
| GET | `/crm/llm/dashboard/kpis` | time-range | KPI block |
| GET | `/crm/llm/dashboard/clients-created` | time-range + `product_code?` SEGUROS\|PROTECT\|MOVIL\|SALUD | counts |
| GET | `/crm/llm/dashboard/client-products` | `startDate?` `endDate?` `company_id?` `product_code?` `date_field?` createdAt\|startDate | product counts |
| GET | `/crm/llm/dashboard/client-products/list` | **`company_id` required**; `product_code?` `status?` active\|pending\|suspended\|cancelled\|expired; dates; `limit?` default 50 max 100; `offset?` | paginated product rows |

### `GET /crm/llm/operators/report`

Query: `startDate` **required**, `endDate` **required** (`YYYY-MM-DD`, start ≤ end).  
`userIds?` comma-separated ints. `supervisor_id?` `company_id?`.  
`install_objective?` 0–1 default 0.5. `sale_objective?` 0–1 default 0.3.

Returns same payload as `GET /crm/reports/operators`, YAML. Staff-level scope.

---

## Recycling, quality, assignment, call-plan, monitor

### `GET /crm/llm/recycling/preview`

No query. Read-only dry-run from saved recipe. Never writes. Returns preview counts (ask human to confirm on ERP UI).

### `GET /crm/llm/recycling/yield`

Query: `run_id?`, `startDate?` `YYYY-MM-DD`, `endDate?`, `company_id?`. Default window last 30 days if no `run_id`.

Returns:

```
ok: true
run: object | null
window: { startDate, endDate }
scope: "company" | "all_companies"
companyId: int | null
cloned, clonedConverted: int
recyclingConversionRate: number | null   # 0–100
fresh, freshConverted: int
freshConversionRate: number | null
delta: number | null
note, answer: string
```

### `GET /crm/llm/data-quality/flags`

Query `limit?` default 200 max 1000 (sample size per flag). Returns flag groups + samples.

### `GET /crm/llm/assignment/recommend`

Query: **`leadId` required** int.

Returns `{ leadId, asOf, window, rule, source, recommendation, alternatives, warnings, answer }`. Advisory only — does not reassign.

### `GET /crm/llm/call-plan`

Query: `date?` `YYYY-MM-DD` (Madrid, default today); `user_id?`; `limit?` default 200 max 500. Ranked call list per operator.

### `POST /crm/llm/monitor/run`

JSON body: `{ checks?: ("stalled"|"trend"|"yield"|"data_quality")[] }`. Manual run, `force: true` server-side. Returns check results + alerts.

### `POST /crm/llm/chat/bot-reply`

JSON (not YAML). Body: `{ conversationId: int, botSlug: string, body: string (max 16000), clientMessageId?: string max 120 }`. Returns created Mensajes message. **Do not use this for CRM data ops.**

---

## Writes — ` /crm/llm/actions`

All JSON. Admin `actor_user_id` required. Typical success:

```
ok: true
action: string
actorUserId: int
answer: string
# plus action-specific ids / counts
```

`idempotency_key?` string 8–120 on most writes.

| method | path | body | extra return |
|---|---|---|---|
| POST | `/crm/llm/actions/leads/bulk-reassign` | `actor_user_id`, `lead_ids` int[] 1–100, `user_id` target operator, **`confirmed: true`**, `reason` 3–500 chars, `idempotency_key?` | `agentUserId`, `targetUserId`, `reason`, `idempotentReplay`, `successCount`, `errorCount`, `success`, `errors` |
| PATCH | `/crm/llm/actions/users/bulk-reassign-operators` | `actor_user_id`, `operators_ids` 1–100, `user_id` supervisor, `idempotency_key?` | `supervisorUserId`, `operatorsCount`, `detail` |
| POST | `/crm/llm/actions/leads/:id/comments` | `actor_user_id`, `content` 1–5000 | `leadId`, `commentId` |
| POST | `/crm/llm/actions/leads` | `actor_user_id`, `name` 1–60, `email`, `phone` 7–15 digits, `company_id?`, `user_id?`, `interest?`, `campaign?`, `idempotency_key?` | `leadId`, name, email, phone, `userId`, `companyId`, `statusId`, `openPath` |
| PATCH | `/crm/llm/actions/leads/:id` | `actor_user_id` + at least one of `name`, `email`, `phone`, `status` (known lead status id), `schedule` datetime\|null, `interest`, `campaign` | lead ids + fields changed |
| POST | `/crm/llm/actions/clients` | `actor_user_id`, `email`, `firstName`, `lastName1`, `lastName2?`, `phone?`, `documentType` int (from document-types), `documentNumber`, `leadId?`, `sourceCompanyId?`, `address?`, `postalCode?`, `locality?`, `province?` | `clientId` |
| PATCH | `/crm/llm/actions/clients/:id` | `actor_user_id` + at least one client field (same names as create, optional) | `clientId` |
| DELETE | `/crm/llm/actions/clients/:id` | `actor_user_id`, `idempotency_key?` | soft-delete result |
| POST | `/crm/llm/actions/clients/:id/restore` | same | restore result |
| POST | `/crm/llm/actions/users` | `actor_user_id`, `email`, `first_name`, `last_name`, `phone?`, `role?`, `service?`, `supervisor?`, `partner_company_id?` | **operator** user; password auto-generated — do not log password if returned |
| PATCH | `/crm/llm/actions/users/:id` | `actor_user_id` + at least one of email, first_name, last_name, phone, role, service, supervisor, partner_company_id | |
| POST | `/crm/llm/actions/users/:id/pause` | `actor_user_id`, `idempotency_key?` | |
| POST | `/crm/llm/actions/users/:id/unpause` | same | |
| DELETE | `/crm/llm/actions/users/:id` | same | |

Phone on create/update lead: digits only after strip, length 7–15.

---

## Adapter rules

1. Build query/body **only** from keys in this file.
2. Map CLI actions (`get-lead`, `create-lead`, …) onto these routes. New CLI action = new mapping here first (ask human if the route is missing).
3. On 4xx/5xx: read error, then SQL fallback on **allowed CRM tables** only.
4. Never send `password`. Never request recording URLs.
