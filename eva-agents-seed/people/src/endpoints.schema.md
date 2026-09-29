# `/hr/llm` schema (save as `src/endpoints.schema.md`)

Source: Nest Zod DTOs in `erp-backend` (employees, recruitment, referrals, leaves, payroll, expenses), 2026-09-09. If Nest ships different keys, stop and ask — do not guess.

## Envelope

| | |
|---|---|
| Auth | Header `X-ERP-Key` from this agent `.env` |
| Success | YAML |
| Errors | 400 / 401 / 403 / 404 — Nest JSON/YAML, not the success shapes |
| Writes | JSON. `actor_user_id` required. `confirmed: true` only after the human confirmed in a later turn (bulk / delete / payroll approve|mark-paid|delete-run|config / expense delete / referral mark-paid|cancel). |

`?` = optional. `date` = `YYYY-MM-DD`. `datetime` = ISO-8601.

---

## Shared: `EmployeeSummary`

```
id: int
employee_number: string
fullName: string | null          # from user_name
email: string | null             # personal_email, else user_email
phone: string | null
employment_status: string        # show as name in chat
position: string | null
department: string | null
user_id: int | null
manager: { id, fullName } | null # responsible_id / responsible_name
leave_balance: string | null
hire_date: string | null
end_date: string | null
```

Get-by-id may also include `base_salary`, bank/gender/civil/contract `{ id, name }`, `rib`, `cnss`, `nickname`, `birthdate`, `id_number`, `address`, `region`, `description`, `is_private`, timestamps. Still always show name/email/phone in chat.

## Shared: `CandidateSummary`

```
id: int
firstName, lastName, email: string
phone: string | null
appliedPosition: string | null
status: string                   # new|screening|interview|documentation|approved|rejected|hired|archived
stage: int
location: string | null
spanishLevel: string | null
createdByName: string | null
hiredAsEmployeeId: int | null
```

## Shared: `LeaveSummary`

```
id: int
userId: int
employee: { id?, fullName, email? } | null
startDate, endDate: date
halfDayStart, halfDayEnd: bool
totalDays: string | number
status: pending | approved | rejected | cancelled
reason: string | null
currentApprover: { id, fullName } | null
approvedBy: { id, fullName } | null
coverUser: { id, fullName } | null
```

---

## Directory

### `GET /hr/llm/directory/users`

Query: `q` required min 2; `limit?` default 10 max 25.

Returns `{ query, count, users: [{ id, firstName, lastName, email, fullName, isActive, roleId, roleName }] }`.

Use `id` as `user_id` / `responsible_id` / `actor_user_id` / `coverUserId` only after a real row. Never invent.

---

## Employees

### `GET /hr/llm/employees/search`

Query:

| key | req | notes |
|---|---|---|
| `search` | ? | name, email, employee number |
| `status` | ? | `active` \| `on_leave` \| `suspended` \| `terminated` \| `sick_leave` |
| `department` | ? | |
| `page` | ? | |
| `page_size` or `limit` | ? | cap 100 for the agent |
| `ordering` | ? | |

Returns `{ count, employees: EmployeeSummary[] }`.

### `GET /hr/llm/employees/:id`

Path `id` int. Returns `EmployeeSummary` (+ extra get fields). 404 if missing.

### `POST /hr/llm/actions/employees`

Omit optional if unknown. Do not invent ids.

- `actor_user_id` — required
- `user_id` — optional (link existing login)
- `recruitment_candidate_id` — optional
- `responsible_id` — optional (manager `users.id`)
- `base_salary` — optional
- `hire_date` — optional datetime
- `phone` — optional
- `personal_email` — optional
- `position` — optional
- `department_id` — optional catalog
- `description` — optional
- `is_private` — optional bool
- `bank_id` — optional
- `employment_contract_type_id` — optional
- `gender_id` — optional
- `civil_status_id` — optional
- `rib` — optional
- `cnss` — optional
- `nickname` — optional
- `birthdate` — optional date
- `id_number` — optional
- `address` — optional
- `region` — optional
- `idempotency_key` — optional

Create does **not** take `employment_status`. Default on server; PATCH to change.

### `POST /hr/llm/actions/employees/from-user`

- `actor_user_id` — required
- `user_id` — required
- `base_salary` — required
- `phone` — optional
- `position` — optional
- `department_id` — optional
- `idempotency_key` — optional

### `PATCH /hr/llm/actions/employees/:id`

- `actor_user_id` — required
- at least one of: `responsible_id`, `base_salary`, `end_date` (date\|null), `employment_status` (`active`\|`on_leave`\|`suspended`\|`terminated`), `phone`, `personal_email`, `position`, `department_id`, `description`, `is_private`, `bank_id`, `employment_contract_type_id`, `gender_id`, `civil_status_id`, `rib`, `cnss`, `nickname`, `birthdate`, `id_number`, `address`, `region`

---

## Recruitment

### `GET /hr/llm/recruitment/candidates/search`

Query: `search?`, `status?` (same enum as CandidateSummary), `position?`, `spanish_level?` (`confirmado`\|`probable`\|`dudoso`\|`no_habla_espanol`), `spanish_review?` (`pending`\|`cleared`), `page?`, `limit?` max 100, `ordering?`.

Returns `{ count, candidates: CandidateSummary[] }`.

### `GET /hr/llm/recruitment/candidates/:id`

Returns CandidateSummary plus cover letter, skills, experience, education, languages, notes, interview fields, `referredBy`, rejection/hire timestamps. Always name/email/phone in chat.

### `POST /hr/llm/actions/recruitment/candidates`

- `actor_user_id` — required
- `first_name` — required
- `last_name` — required
- `email` — required
- `phone` — optional
- `applied_position` — optional
- `expected_salary` — optional
- `available_from` — optional date
- `cover_letter` — optional
- `skills` — optional string[]
- `experience` — optional
- `education` — optional
- `location` — optional
- `languages` — optional `{ name?, level? }[]`
- `source` — optional
- `idempotency_key` — optional

Do not invent `status` on create (server default `new`). Other stage = PATCH or move-stage.

### `PATCH /hr/llm/actions/recruitment/candidates/:id`

- `actor_user_id` — required
- at least one of: `first_name`, `last_name`, `email`, `phone`, `applied_position`, `expected_salary`, `available_from`, `cover_letter`, `skills`, `experience`, `education`, `location`, `languages`, `notes`, `interview_date`, `interview_notes`, `source`

### `POST /hr/llm/actions/recruitment/candidates/:id/move-stage`

- `actor_user_id` — required
- `notes` — optional
- `interview_date` — optional datetime
- `interview_notes` — optional

### `POST /hr/llm/actions/recruitment/candidates/:id/reject`

- `actor_user_id` — required
- `rejection_reason` — required

### `POST /hr/llm/actions/recruitment/candidates/:id/hire`

- `actor_user_id` — required
- `base_salary` — required
- `hire_date` — optional date
- `position` — optional
- `department` — optional string (Nest hire DTO; not `department_id`)

No CV file upload over LLM. If the human needs a CV stored, say so and use SQL/docs only if already granted — do not invent multipart keys.

---

## Leaves

Leave table name in SQL: `leaves_requests`. Status: `pending` \| `approved` \| `rejected` \| `cancelled`.

### `GET /hr/llm/leaves/requests/search`

Query: `status?`, `user_id?`, `limit?`.

Returns `{ count, requests: LeaveSummary[] }`.

### `GET /hr/llm/leaves/requests/:id`

Returns `LeaveSummary`. 404 if missing.

### `POST /hr/llm/actions/leaves/requests`

Creates a request **for** `user_id` (HR acting for someone). Omit optional.

- `actor_user_id` — required
- `user_id` — required (employee’s login)
- `startDate` — required date
- `endDate` — required date
- `halfDayStart` — optional bool
- `halfDayEnd` — optional bool
- `reason` — optional
- `idempotency_key` — optional

### `PATCH /hr/llm/actions/leaves/requests/:id`

- `actor_user_id` — required
- `startDate` — optional
- `endDate` — optional

### `POST /hr/llm/actions/leaves/requests/:id/approve`

Single row: execute same turn (not bulk).

- `actor_user_id` — required
- `notes` — optional
- `coverUserId` — optional int or null
- `coverageNotes` — optional

### `POST /hr/llm/actions/leaves/requests/:id/reject`

- `actor_user_id` — required
- `rejectionReason` — required

### `POST /hr/llm/actions/leaves/requests/:id/cancel`

- `actor_user_id` — required

### `POST /hr/llm/actions/leaves/balance/adjust`

Confirm with human (money/days).

- `actor_user_id` — required
- `user_id` — required
- `amount` — required number
- `reason` — required
- `confirmed` — required true after they confirm
- `idempotency_key` — optional

---

## Referrals (admin)

### `GET /hr/llm/referrals/search`

Query: `status?` = `owed` to list unpaid earned halves; `page?`.

Returns list + `owedTotal` when present. Show referrer and candidate **names**.

### `POST /hr/llm/actions/referrals/:id/mark-paid/:half`

`half` = `first` \| `second`. Confirm first.

- `actor_user_id` — required
- `confirmed` — required true after confirm

### `POST /hr/llm/actions/referrals/:id/cancel`

Confirm first.

- `actor_user_id` — required
- `reason` — required (min 10 chars)
- `confirmed` — required true after confirm

### `POST /hr/llm/actions/referrals/:id/reinstate`

- `actor_user_id` — required

---

## Payroll (nómina)

JWT source: `GET|POST /payroll/...`. LLM prefix `/hr/llm`. Status: `draft` \| `approved` \| `paid`. SQL tables: `payroll_runs`, `payroll_entries`, `payroll_config`.

People on entries: `employee: { id, fullName }` — never employeeId alone in chat.

Rates in config are **fractions** (0.35 = 35%), not 35.

### `GET /hr/llm/payroll/runs`

Query: `limit?` 1–100 default 50; `offset?`; `month?` 1–12; `year?`.

Returns `{ runs: PayrollRun[], total: int }` (no entries, or thin). `PayrollRun`: `id`, `month`, `year`, `workingDays`, `status`, `approvedBy: { id, fullName } | null`, `approvedAt`, `paidAt`, `totalGross`, `totalNet`, `invoiceAmount`, `invoiceNumber`.

### `GET /hr/llm/payroll/runs/:id`

Returns run + `entries[]`. Each entry: `id`, `employeeId`, `employee: { id, fullName }`, `daysWorked`, `sickDays`, `absentDays`, `prima`, `primeAnciennete`, `salaireBrut`, `salaire`, `fp`, `cnss`, `amo`, `sni`, `igrBrut`, `pCharges`, `igrNet`, `totalRetenues`, `salaireNet`, `netAPayer`. 404 if missing.

### `POST /hr/llm/actions/payroll/runs`

Get-or-create draft for that month.

- `actor_user_id` — required
- `month` — required 1–12
- `year` — required
- `workingDays` — optional 1–31
- `idempotency_key` — optional

### `POST /hr/llm/actions/payroll/runs/:id/calculate`

Recalculate all entries. Draft only.

- `actor_user_id` — required

### `PATCH /hr/llm/actions/payroll/runs/:id/entries/:employeeId`

Draft only. Then server recalculates that row. `daysWorked` is derived (workingDays − sick − absent); do not send it.

- `actor_user_id` — required
- `sickDays` — optional number 0–31
- `absentDays` — optional number 0–31
- `prima` — optional money ≥ 0
- `primeAnciennete` — optional money ≥ 0

### `POST /hr/llm/actions/payroll/runs/:id/approve`

Confirm first.

- `actor_user_id` — required
- `invoiceNumber` — optional max 30
- `invoiceAmount` — optional money ≥ 0
- `confirmed` — required true after confirm

### `POST /hr/llm/actions/payroll/runs/:id/mark-paid`

Confirm first. Does not move money.

- `actor_user_id` — required
- `confirmed` — required true after confirm

### `DELETE /hr/llm/actions/payroll/runs/:id`

Confirm first.

- `actor_user_id` — required
- `confirmed` — required true after confirm

### `GET /hr/llm/payroll/config`

Returns config: `fpRate`, `fpCap`, `fpRateReduced`, `fpThreshold`, `cnssRate`, `cnssCap`, `amoRate`, `childDeduction`, `defaultWorkingDays`, `maxChildrenDeduction`, `igrBrackets[]` (`max` number\|null, `rate`, `deduction`), `seniorityBrackets[]` (`minYears`, `rate`).

### `PATCH /hr/llm/actions/payroll/config`

Confirm first. At least one field. Rates 0–1.

- `actor_user_id` — required
- `confirmed` — required true after confirm
- `fpRate` — optional
- `fpCap` — optional
- `fpRateReduced` — optional
- `fpThreshold` — optional
- `cnssRate` — optional
- `cnssCap` — optional
- `amoRate` — optional
- `childDeduction` — optional
- `defaultWorkingDays` — optional
- `igrBrackets` — optional
- `seniorityBrackets` — optional
- `maxChildrenDeduction` — optional

---

## Company expenses (gastos)

JWT source: `/expenses`. Not `rrhh_invoices` (Facturas). Categories: `agua_electricidad` \| `internet` \| `alquiler` \| `otros`. Status: `draft` \| `confirmed`. SQL: `expense_entries`, `expense_templates`. Write keys are **snake_case** as in Nest Zod.

### `GET /hr/llm/expenses`

Query: `month` required; `year` required; `category?`; `status?`.

Returns `{ month, year, expenses[], byCategory[], total }`. Chat: vendor name + amount + category label, not ids only.

### `POST /hr/llm/actions/expenses`

Manual line is created `confirmed`. Omit optional.

- `actor_user_id` — required
- `category` — required
- `period_month` — required
- `period_year` — required
- `vendor_name` — required
- `total_amount` — required ≥ 0
- `concept` — optional
- `currency` — optional default `MAD` (3 letters)
- `invoice_number` — optional
- `issue_date` — optional date
- `notes` — optional
- `idempotency_key` — optional

Do not send `file_path` / storage keys.

### `PATCH /hr/llm/actions/expenses/:id`

- `actor_user_id` — required
- same fields as create, all optional, plus `status` (`draft`\|`confirmed`)
- at least one field

### `DELETE /hr/llm/actions/expenses/:id`

Confirm first.

- `actor_user_id` — required
- `confirmed` — required true after confirm

### `POST /hr/llm/actions/expenses/generate`

Materialise active templates into **draft** rows for that month.

- `actor_user_id` — required
- `month` — required
- `year` — required

### `GET /hr/llm/expenses/templates`

Query: `active?` bool.

### `POST /hr/llm/actions/expenses/templates`

- `actor_user_id` — required
- `category` — required
- `vendor_name` — required
- `amount` — required ≥ 0
- `concept` — optional
- `currency` — optional default `MAD`
- `is_active` — optional bool default true
- `notes` — optional

### `PATCH /hr/llm/actions/expenses/templates/:id`

- `actor_user_id` — required
- any subset of create-template fields

### `DELETE /hr/llm/actions/expenses/templates/:id`

Confirm first.

- `actor_user_id` — required
- `confirmed` — required true after confirm

---

## Adapter rules

1. Query/body **only** keys in this schema.
2. On 4xx/5xx: then SQL on allowed HR tables.
3. Never send `password`. Never call `/crm/llm/*`.
4. `SELECT * FROM leads` must fail as `bb_hr`. If it succeeds, stop and tell the human the role is wrong.

## When you are done

Reply with the file list you changed. AGENTS.md must contain the Reply style above. `src/endpoints.schema.md` must match this schema. Do not print secrets.
