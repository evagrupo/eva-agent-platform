import dotenv from 'dotenv';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(workspaceRoot, '.env.hr-bootstrap');
const gapLogPath = resolve(workspaceRoot, 'sql', 'http-gaps.md');

let bootstrapEnv = {};
try {
  bootstrapEnv = dotenv.parse(await readFile(envPath, 'utf8'));
} catch {
  bootstrapEnv = {};
}

const ROUTES = [
  ['GET', '/hr/llm/directory/users'],
  ['GET', '/hr/llm/employees/search'],
  ['GET', '/hr/llm/employees/:id'],
  ['POST', '/hr/llm/actions/employees'],
  ['POST', '/hr/llm/actions/employees/from-user'],
  ['PATCH', '/hr/llm/actions/employees/:id'],
  ['GET', '/hr/llm/recruitment/candidates/search'],
  ['GET', '/hr/llm/recruitment/candidates/:id'],
  ['POST', '/hr/llm/actions/recruitment/candidates'],
  ['PATCH', '/hr/llm/actions/recruitment/candidates/:id'],
  ['POST', '/hr/llm/actions/recruitment/candidates/:id/move-stage'],
  ['POST', '/hr/llm/actions/recruitment/candidates/:id/reject'],
  ['POST', '/hr/llm/actions/recruitment/candidates/:id/hire'],
  ['GET', '/hr/llm/leaves/requests/search'],
  ['GET', '/hr/llm/leaves/requests/:id'],
  ['POST', '/hr/llm/actions/leaves/requests'],
  ['PATCH', '/hr/llm/actions/leaves/requests/:id'],
  ['POST', '/hr/llm/actions/leaves/requests/:id/approve'],
  ['POST', '/hr/llm/actions/leaves/requests/:id/reject'],
  ['POST', '/hr/llm/actions/leaves/requests/:id/cancel'],
  ['POST', '/hr/llm/actions/leaves/balance/adjust'],
  ['GET', '/hr/llm/referrals/search'],
  ['POST', '/hr/llm/actions/referrals/:id/mark-paid/:half'],
  ['POST', '/hr/llm/actions/referrals/:id/cancel'],
  ['POST', '/hr/llm/actions/referrals/:id/reinstate'],
  ['GET', '/hr/llm/payroll/runs'],
  ['GET', '/hr/llm/payroll/runs/:id'],
  ['POST', '/hr/llm/actions/payroll/runs'],
  ['POST', '/hr/llm/actions/payroll/runs/:id/calculate'],
  ['PATCH', '/hr/llm/actions/payroll/runs/:id/entries/:employeeId'],
  ['POST', '/hr/llm/actions/payroll/runs/:id/approve'],
  ['POST', '/hr/llm/actions/payroll/runs/:id/mark-paid'],
  ['DELETE', '/hr/llm/actions/payroll/runs/:id'],
  ['GET', '/hr/llm/payroll/config'],
  ['PATCH', '/hr/llm/actions/payroll/config'],
  ['GET', '/hr/llm/expenses'],
  ['POST', '/hr/llm/actions/expenses'],
  ['PATCH', '/hr/llm/actions/expenses/:id'],
  ['DELETE', '/hr/llm/actions/expenses/:id'],
  ['POST', '/hr/llm/actions/expenses/generate'],
  ['GET', '/hr/llm/expenses/templates'],
  ['POST', '/hr/llm/actions/expenses/templates'],
  ['PATCH', '/hr/llm/actions/expenses/templates/:id'],
  ['DELETE', '/hr/llm/actions/expenses/templates/:id'],
];

const SQL_ALLOWED_TABLES = new Set([
  'public.employees',
  'public.employee_documents',
  'public.recruitment_candidates',
  'public.recruitment_candidate_documents',
  'public.referrals',
  'public.leaves_requests',
  'public.leaves_balance_adjustments',
  'public.leaves_absences',
  'public.leaves_sick_leaves',
  'public.leaves_lateness',
  'public.leaves_holidays',
  'public.leaves_user_shift_configs',
  'public.leaves_role_shift_configs',
  'public.rrhh_invoices',
  'public.payroll_runs',
  'public.payroll_entries',
  'public.payroll_config',
  'public.expense_entries',
  'public.expense_templates',
  'public.talento_courses',
  'public.talento_modules',
  'public.talento_folders',
  'public.talento_docs',
  'public.talento_lessons',
  'public.talento_assignments',
  'public.talento_assignment_rules',
  'public.talento_enrollments',
  'public.talento_lesson_progress',
  'public.talento_quizzes',
  'public.talento_quiz_attempts',
  'public.talento_scorm_packages',
  'public.talento_scorm_attempts',
  'public.catalogs',
  'public.catalog_types',
  'public.user_supervisors',
  'agent_share.hr_users',
]);

const positiveInt = z.coerce.number().int().positive();
const finiteNumber = z.coerce.number().refine(Number.isFinite, 'must be a finite number');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const datetime = z.string().datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);
const status = z.enum(['active', 'on_leave', 'suspended', 'terminated', 'sick_leave']);
const candidateStatus = z.enum(['new', 'screening', 'interview', 'documentation', 'approved', 'rejected', 'hired', 'archived']);
const leaveStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled']);
const spanishLevel = z.enum(['confirmado', 'probable', 'dudoso', 'no_habla_espanol']);
const spanishReview = z.enum(['pending', 'cleared']);
const employmentStatus = z.enum(['active', 'on_leave', 'suspended', 'terminated']);
const idempotencyKey = z.string().min(8).max(120);
const actor = { actor_user_id: positiveInt.optional() };
const language = z.object({ name: nonEmpty.optional(), level: nonEmpty.optional() }).strict();

const directorySearchInput = z.object({
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(25).optional(),
}).strict();

const employeeSearchInput = z.object({
  search: nonEmpty.optional(),
  status: status.optional(),
  department: nonEmpty.optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ordering: nonEmpty.optional(),
}).strict();

const employeeCreateInput = z.object({
  ...actor,
  user_id: positiveInt.optional(),
  recruitment_candidate_id: positiveInt.optional(),
  responsible_id: positiveInt.optional(),
  base_salary: finiteNumber.optional(),
  hire_date: datetime.optional(),
  phone: nonEmpty.optional(),
  personal_email: z.string().email().optional(),
  position: nonEmpty.optional(),
  department_id: positiveInt.optional(),
  description: z.string().optional(),
  is_private: z.boolean().optional(),
  bank_id: positiveInt.optional(),
  employment_contract_type_id: positiveInt.optional(),
  gender_id: positiveInt.optional(),
  civil_status_id: positiveInt.optional(),
  rib: z.string().optional(),
  cnss: z.string().optional(),
  nickname: z.string().optional(),
  birthdate: date.optional(),
  id_number: z.string().optional(),
  address: z.string().optional(),
  region: z.string().optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const employeeFromUserInput = z.object({
  ...actor,
  user_id: positiveInt,
  base_salary: finiteNumber,
  phone: nonEmpty.optional(),
  position: nonEmpty.optional(),
  department_id: positiveInt.optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const employeePatchInput = z.object({
  ...actor,
  responsible_id: positiveInt.optional(),
  base_salary: finiteNumber.optional(),
  end_date: date.nullable().optional(),
  employment_status: employmentStatus.optional(),
  phone: nonEmpty.optional(),
  personal_email: z.string().email().optional(),
  position: nonEmpty.optional(),
  department_id: positiveInt.optional(),
  description: z.string().optional(),
  is_private: z.boolean().optional(),
  bank_id: positiveInt.optional(),
  employment_contract_type_id: positiveInt.optional(),
  gender_id: positiveInt.optional(),
  civil_status_id: positiveInt.optional(),
  rib: z.string().optional(),
  cnss: z.string().optional(),
  nickname: z.string().optional(),
  birthdate: date.nullable().optional(),
  id_number: z.string().optional(),
  address: z.string().optional(),
  region: z.string().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'actor_user_id'), {
  message: 'at least one employee field is required',
});

const candidateSearchInput = z.object({
  search: nonEmpty.optional(),
  status: candidateStatus.optional(),
  position: nonEmpty.optional(),
  spanish_level: spanishLevel.optional(),
  spanish_review: spanishReview.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ordering: nonEmpty.optional(),
}).strict();

const candidateCreateInput = z.object({
  ...actor,
  first_name: nonEmpty,
  last_name: nonEmpty,
  email: z.string().email(),
  phone: nonEmpty.optional(),
  applied_position: nonEmpty.optional(),
  expected_salary: finiteNumber.optional(),
  available_from: date.optional(),
  cover_letter: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experience: z.unknown().optional(),
  education: z.unknown().optional(),
  location: nonEmpty.optional(),
  languages: z.array(language).optional(),
  source: nonEmpty.optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const candidatePatchInput = z.object({
  ...actor,
  first_name: nonEmpty.optional(),
  last_name: nonEmpty.optional(),
  email: z.string().email().optional(),
  phone: nonEmpty.optional(),
  applied_position: nonEmpty.optional(),
  expected_salary: finiteNumber.optional(),
  available_from: date.nullable().optional(),
  cover_letter: z.string().optional(),
  skills: z.array(z.string()).optional(),
  experience: z.unknown().optional(),
  education: z.unknown().optional(),
  location: nonEmpty.optional(),
  languages: z.array(language).optional(),
  notes: z.string().optional(),
  interview_date: datetime.nullable().optional(),
  interview_notes: z.string().optional(),
  source: nonEmpty.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'actor_user_id'), {
  message: 'at least one candidate field is required',
});

const candidateMoveStageInput = z.object({
  ...actor,
  notes: z.string().optional(),
  interview_date: datetime.optional(),
  interview_notes: z.string().optional(),
}).strict();

const candidateRejectInput = z.object({
  ...actor,
  rejection_reason: nonEmpty,
}).strict();

const candidateHireInput = z.object({
  ...actor,
  base_salary: finiteNumber,
  hire_date: date.optional(),
  position: nonEmpty.optional(),
  department: nonEmpty.optional(),
}).strict();

const leaveSearchInput = z.object({
  status: leaveStatus.optional(),
  user_id: positiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

const leaveCreateInput = z.object({
  ...actor,
  user_id: positiveInt,
  startDate: date,
  endDate: date,
  halfDayStart: z.boolean().optional(),
  halfDayEnd: z.boolean().optional(),
  reason: z.string().optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const leavePatchInput = z.object({
  ...actor,
  startDate: date.optional(),
  endDate: date.optional(),
}).strict().refine((value) => value.startDate !== undefined || value.endDate !== undefined, {
  message: 'startDate or endDate is required',
});

const leaveApproveInput = z.object({
  ...actor,
  notes: z.string().optional(),
  coverUserId: positiveInt.nullable().optional(),
  coverageNotes: z.string().optional(),
}).strict();

const leaveRejectInput = z.object({
  ...actor,
  rejectionReason: nonEmpty,
}).strict();

const leaveCancelInput = z.object({ ...actor }).strict();

const leaveBalanceAdjustInput = z.object({
  ...actor,
  user_id: positiveInt,
  amount: finiteNumber,
  reason: nonEmpty,
  confirmed: z.literal(true),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const referralSearchInput = z.object({
  status: z.literal('owed').optional(),
  page: z.coerce.number().int().min(1).optional(),
}).strict();

const referralMarkPaidInput = z.object({
  ...actor,
  confirmed: z.literal(true),
}).strict();

const referralCancelInput = z.object({
  ...actor,
  reason: z.string().trim().min(10),
  confirmed: z.literal(true),
}).strict();

const referralReinstateInput = z.object({ ...actor }).strict();

const payrollStatus = z.enum(['draft', 'approved', 'paid']);
const expenseCategory = z.enum(['agua_electricidad', 'internet', 'alquiler', 'otros']);
const expenseStatus = z.enum(['draft', 'confirmed']);
const monthNumber = z.coerce.number().int().min(1).max(12);
const yearNumber = z.coerce.number().int().min(1);
const money = finiteNumber.refine((value) => value >= 0, 'must be at least zero');
const rate = finiteNumber.min(0).max(1);
const payrollLimit = z.coerce.number().int().min(1).max(100);
const payrollOffset = z.coerce.number().int().min(0);
const payrollRunsSearchInput = z.object({
  limit: payrollLimit.optional(),
  offset: payrollOffset.optional(),
  month: monthNumber.optional(),
  year: yearNumber.optional(),
}).strict();

const payrollRunCreateInput = z.object({
  ...actor,
  month: monthNumber,
  year: yearNumber,
  workingDays: z.coerce.number().int().min(1).max(31).optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const payrollActorInput = z.object({ ...actor }).strict();

const payrollEntryPatchInput = z.object({
  ...actor,
  sickDays: z.coerce.number().min(0).max(31).optional(),
  absentDays: z.coerce.number().min(0).max(31).optional(),
  prima: money.optional(),
  primeAnciennete: money.optional(),
}).strict();

const payrollApproveInput = z.object({
  ...actor,
  invoiceNumber: z.string().max(30).optional(),
  invoiceAmount: money.optional(),
  confirmed: z.literal(true),
}).strict();

const payrollConfirmInput = z.object({
  ...actor,
  confirmed: z.literal(true),
}).strict();

const configNumber = z.number().refine(Number.isFinite, 'must be a finite number');
const configNullableNumber = z.union([configNumber, z.null()]);
const igrBracketInput = z.object({
  max: configNullableNumber,
  rate,
  deduction: money,
}).strict();
const seniorityBracketInput = z.object({
  minYears: configNumber,
  rate,
}).strict();

const payrollConfigPatchInput = z.object({
  ...actor,
  confirmed: z.literal(true),
  fpRate: rate.optional(),
  fpCap: money.optional(),
  fpRateReduced: rate.optional(),
  fpThreshold: money.optional(),
  cnssRate: rate.optional(),
  cnssCap: money.optional(),
  amoRate: rate.optional(),
  childDeduction: money.optional(),
  defaultWorkingDays: z.coerce.number().int().min(1).max(31).optional(),
  igrBrackets: z.array(igrBracketInput).optional(),
  seniorityBrackets: z.array(seniorityBracketInput).optional(),
  maxChildrenDeduction: money.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !['actor_user_id', 'confirmed'].includes(key)), {
  message: 'at least one payroll config field is required',
});

const expenseSearchInput = z.object({
  month: monthNumber,
  year: yearNumber,
  category: expenseCategory.optional(),
  status: expenseStatus.optional(),
}).strict();

const currency = z.string().regex(/^[A-Za-z]{3}$/, 'must be a three-letter currency');

const expenseCreateInput = z.object({
  ...actor,
  category: expenseCategory,
  period_month: monthNumber,
  period_year: yearNumber,
  vendor_name: nonEmpty,
  total_amount: money,
  concept: z.string().optional(),
  currency: currency.optional(),
  invoice_number: z.string().optional(),
  issue_date: date.optional(),
  notes: z.string().optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict();

const expensePatchInput = z.object({
  ...actor,
  category: expenseCategory.optional(),
  period_month: monthNumber.optional(),
  period_year: yearNumber.optional(),
  vendor_name: nonEmpty.optional(),
  total_amount: money.optional(),
  concept: z.string().optional(),
  currency: currency.optional(),
  invoice_number: z.string().optional(),
  issue_date: date.optional(),
  notes: z.string().optional(),
  status: expenseStatus.optional(),
  idempotency_key: idempotencyKey.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'actor_user_id'), {
  message: 'at least one expense field is required',
});

const expenseDeleteInput = z.object({
  ...actor,
  confirmed: z.literal(true),
}).strict();

const expenseGenerateInput = z.object({
  ...actor,
  month: monthNumber,
  year: yearNumber,
}).strict();

const expenseTemplateSearchInput = z.object({
  active: z.boolean().optional(),
}).strict();

const expenseTemplateCreateInput = z.object({
  ...actor,
  category: expenseCategory,
  vendor_name: nonEmpty,
  amount: money,
  concept: z.string().optional(),
  currency: currency.optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional(),
}).strict();

const expenseTemplatePatchInput = z.object({
  ...actor,
  category: expenseCategory.optional(),
  vendor_name: nonEmpty.optional(),
  amount: money.optional(),
  concept: z.string().optional(),
  currency: currency.optional(),
  is_active: z.boolean().optional(),
  notes: z.string().optional(),
}).strict();

export class HttpRouteError extends Error {
  constructor({ method, path, reason, status }) {
    super(method + ' ' + path + ': ' + reason);
    this.name = 'HttpRouteError';
    this.method = method;
    this.path = path;
    this.reason = reason;
    this.status = status;
  }
}

function envValue(name) {
  const value = bootstrapEnv[name];
  if (!value) throw new Error(name + ' is not configured in .env.hr-bootstrap.');
  return value;
}

function configuredActorUserId() {
  const value = bootstrapEnv.ACTOR_USER_ID ?? process.env.ACTOR_USER_ID;
  const parsed = positiveInt.safeParse(value);
  if (!parsed.success) throw new Error('ACTOR_USER_ID is not configured for this EVA agent.');
  return parsed.data;
}

function withActor(body) {
  return { ...body, actor_user_id: configuredActorUserId() };
}

function copyObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Input must be a JSON object.');
  }
  return { ...input };
}

function nonBlankValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function aliasValue(input, firstKey, secondKey) {
  const first = nonBlankValue(input[firstKey]);
  const second = nonBlankValue(input[secondKey]);
  if (first && second && first.toLowerCase() !== second.toLowerCase()) {
    throw new Error(firstKey + ' and ' + secondKey + ' must match.');
  }
  delete input[firstKey];
  delete input[secondKey];
  return first || second;
}

function normalizedText(value) {
  return nonBlankValue(value)?.toLowerCase() || '';
}

function personLabel(person) {
  const name = nonBlankValue(person?.fullName)
    || fullName(person?.firstName, person?.lastName)
    || 'Unknown';
  return name + ' — ' + (nonBlankValue(person?.email) || 'none');
}

function chooseSinglePerson(matches, query, kind) {
  if (!matches.length) throw new Error(kind + ' not found: ' + query + '.');
  if (matches.length > 1) {
    throw new Error(kind + ' matches multiple people:\n' + matches.map(personLabel).join('\n'));
  }
  const id = positiveInt.safeParse(matches[0]?.id);
  if (!id.success) throw new Error(kind + ' result has no usable id.');
  return id.data;
}

async function resolveDirectoryUsername(username) {
  const query = nonBlankValue(username);
  if (!query) throw new Error('username is required.');
  const result = await searchDirectoryUsers({ q: query, limit: 25 });
  const users = Array.isArray(result?.users) ? result.users : [];
  const normalizedQuery = normalizedText(query);
  const exact = users.filter((user) => [
    user.email,
    user.fullName,
    fullName(user.firstName, user.lastName),
  ].some((value) => normalizedText(value) === normalizedQuery));
  return chooseSinglePerson(exact.length ? exact : users, query, 'Username');
}

function candidateLabel(candidate) {
  const name = fullName(candidate?.firstName, candidate?.lastName) || 'Unknown';
  return name + ' — ' + (nonBlankValue(candidate?.email) || 'none');
}

async function resolveCandidateName(candidateName) {
  const query = nonBlankValue(candidateName);
  if (!query) throw new Error('candidate_name is required.');
  const result = await searchCandidates({ search: query, limit: 100 });
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const normalizedQuery = normalizedText(query);
  const exact = candidates.filter((candidate) => {
    const candidateFullName = fullName(candidate.firstName, candidate.lastName);
    return normalizedText(candidateFullName) === normalizedQuery
      || normalizedText(candidate.email) === normalizedQuery;
  });
  if (!candidates.length) throw new Error('Candidate not found: ' + query + '.');
  if (exact.length === 1) {
    const id = positiveInt.safeParse(exact[0]?.id);
    if (!id.success) throw new Error('Candidate result has no usable id.');
    return id.data;
  }
  if (exact.length > 1) {
    throw new Error('Candidate name matches multiple people:\n' + exact.map(candidateLabel).join('\n'));
  }
  if (candidates.length > 1) {
    throw new Error('Candidate name matches multiple people:\n' + candidates.map(candidateLabel).join('\n'));
  }
  const id = positiveInt.safeParse(candidates[0]?.id);
  if (!id.success) throw new Error('Candidate result has no usable id.');
  return id.data;
}

async function normalizeEmployeeCreateInput(input) {
  const copy = copyObject(input);
  const username = aliasValue(copy, 'username', 'userName');
  const candidateName = aliasValue(copy, 'candidate_name', 'candidateName');
  if (!nonBlankValue(copy.phone)) throw new Error('phone is required.');
  if (!nonBlankValue(copy.personal_email)) throw new Error('personal_email is required.');
  if ((username ? 1 : 0) + (candidateName ? 1 : 0) !== 1) {
    throw new Error('Provide exactly one of username or candidate_name.');
  }
  delete copy.user_id;
  if (username) copy.user_id = await resolveDirectoryUsername(username);
  if (candidateName) copy.recruitment_candidate_id = await resolveCandidateName(candidateName);
  const managerUsername = aliasValue(copy, 'manager_username', 'managerUsername');
  if (managerUsername) copy.responsible_id = await resolveDirectoryUsername(managerUsername);
  return copy;
}

async function normalizeEmployeeFromUserInput(input) {
  const copy = copyObject(input);
  const username = aliasValue(copy, 'username', 'userName');
  if (!username) throw new Error('username is required.');
  if (!nonBlankValue(copy.phone)) throw new Error('phone is required.');
  if (copy.base_salary === undefined || copy.base_salary === null || copy.base_salary === '') {
    throw new Error('base_salary is required.');
  }
  delete copy.user_id;
  copy.user_id = await resolveDirectoryUsername(username);
  return copy;
}

async function normalizeEmployeePatchInput(input) {
  const copy = copyObject(input);
  const managerUsername = aliasValue(copy, 'manager_username', 'managerUsername');
  if (managerUsername) copy.responsible_id = await resolveDirectoryUsername(managerUsername);
  return copy;
}

async function normalizeLeaveCreateInput(input) {
  const copy = copyObject(input);
  const username = aliasValue(copy, 'username', 'userName');
  if (!username) throw new Error('username is required.');
  delete copy.user_id;
  copy.user_id = await resolveDirectoryUsername(username);
  return copy;
}

async function normalizeLeaveSearchInput(input) {
  const copy = copyObject(input);
  const username = aliasValue(copy, 'username', 'userName');
  if (username) {
    delete copy.user_id;
    copy.user_id = await resolveDirectoryUsername(username);
  }
  return copy;
}

async function normalizeLeaveApproveInput(input) {
  const copy = copyObject(input);
  const coverUsername = aliasValue(copy, 'cover_username', 'coverUsername');
  if (coverUsername) {
    delete copy.coverUserId;
    copy.coverUserId = await resolveDirectoryUsername(coverUsername);
  }
  return copy;
}

async function normalizeLeaveBalanceInput(input) {
  const copy = copyObject(input);
  const username = aliasValue(copy, 'username', 'userName');
  if (!username) throw new Error('username is required.');
  delete copy.user_id;
  copy.user_id = await resolveDirectoryUsername(username);
  return copy;
}

function erpBaseUrl() {
  const value = envValue('ERP_BASE_URL').trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function erpKey() {
  return envValue('X_ERP_API_KEY');
}

function sqlUrl() {
  const value = envValue('DATABASE_URL');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.');
  }
  let username;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    username = parsed.username;
  }
  if (username !== 'bb_hr') throw new Error('DATABASE_URL must use the bb_hr role.');
  return value;
}

function routeMatches(template, path) {
  const pattern = '^' + template
    .replaceAll(':id', '[0-9]+')
    .replaceAll(':employeeId', '[0-9]+')
    .replaceAll(':half', '(?:first|second)') + '$';
  return new RegExp(pattern).test(path);
}

function assertRoute(method, path) {
  if (path.includes('/crm/llm')) throw new Error('CRM routes are forbidden in the HR workspace.');
  if (!ROUTES.some(([allowedMethod, template]) => allowedMethod === method && routeMatches(template, path))) {
    throw new Error('Undocumented HR route denied: ' + method + ' ' + path);
  }
}

function buildUrl(path, query) {
  const url = new URL(erpBaseUrl() + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function request(method, path, { query, body } = {}) {
  assertRoute(method, path);
  const url = buildUrl(path, query);
  const key = erpKey();
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'X-ERP-Key': key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new HttpRouteError({
      method,
      path,
      reason: error?.name === 'TimeoutError' ? 'timeout' : 'network failure',
    });
  }

  try {
    payload = await response.text();
  } catch (error) {
    throw new HttpRouteError({
      method,
      path,
      reason: error?.name === 'TimeoutError' ? 'timeout' : 'network failure',
    });
  }
  if (!response.ok) {
    throw new HttpRouteError({ method, path, status: response.status, reason: 'HTTP ' + response.status });
  }
  if (!payload.trim()) return {};

  try {
    const parsed = method === 'GET' ? parseYaml(payload) : JSON.parse(payload);
    if (parsed === null || typeof parsed !== 'object') throw new Error('unexpected payload shape');
    return parsed;
  } catch {
    throw new HttpRouteError({ method, path, status: response.status, reason: 'invalid success payload' });
  }
}

function assertSqlAllowed(table) {
  if (!SQL_ALLOWED_TABLES.has(table)) throw new Error('SQL fallback denied for ' + table + '.');
}

async function recordHttpGap(error, table) {
  await mkdir(dirname(gapLogPath), { recursive: true });
  const failure = error.status ? 'HTTP ' + error.status : error.reason;
  const line = '- ' + new Date().toISOString() + ' — ' + error.method + ' ' + error.path + '; ' + failure + '; SQL fallback: ' + table + '. Ask ERP to add/fix the /hr/llm route.\n';
  await appendFile(gapLogPath, line);
}

async function withSql(work) {
  const client = postgres(sqlUrl(), { max: 1, prepare: false });
  try {
    return await client.begin((transaction) => work(transaction));
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function sqlFallback(error, table, work) {
  assertSqlAllowed(table);
  const result = await withSql(work);
  await recordHttpGap(error, table);
  return result;
}

function asDate(value) {
  if (value === null || value === undefined) return value ?? null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function fullName(firstName, lastName) {
  const value = [firstName, lastName].filter(Boolean).join(' ').trim();
  return value || null;
}

function mapEmployee(row) {
  if (!row) return null;
  const linkedName = fullName(row.user_first_name, row.user_last_name);
  const managerName = fullName(row.manager_first_name, row.manager_last_name);
  return {
    id: Number(row.id),
    employee_number: row.employee_number == null ? '' : String(row.employee_number),
    fullName: linkedName,
    email: row.personal_email ?? row.user_email ?? null,
    phone: row.phone ?? null,
    employment_status: row.employment_status == null ? '' : String(row.employment_status),
    position: row.position ?? null,
    department: null,
    user_id: row.user_id == null ? null : Number(row.user_id),
    manager: row.responsible_id == null ? null : { id: Number(row.responsible_id), fullName: managerName },
    leave_balance: null,
    hire_date: asDate(row.hire_date),
    end_date: asDate(row.end_date),
  };
}

const EMPLOYEE_SELECT = '  SELECT e.id, e.employee_number, e.user_id, e.responsible_id,\\n'
  + '         e.employment_status, e.position, e.phone, e.personal_email,\\n'
  + '         e.hire_date, e.end_date,\\n'
  + '         linked.first_name AS user_first_name, linked.last_name AS user_last_name,\\n'
  + '         linked.email AS user_email,\\n'
  + '         manager.first_name AS manager_first_name, manager.last_name AS manager_last_name\\n'
  + '    FROM public.employees e\\n'
  + '    LEFT JOIN agent_share.hr_users linked ON linked.id = e.user_id\\n'
  + '    LEFT JOIN agent_share.hr_users manager ON manager.id = e.responsible_id';

async function employeeById(db, id) {
  const rows = await db.unsafe(EMPLOYEE_SELECT + ' WHERE e.id = $1 LIMIT 1', [id]);
  return mapEmployee(rows[0]);
}

async function employeesBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  if (query.search) {
    const base = params.length + 1;
    const phrase = '%' + query.search + '%';
    params.push(phrase, phrase, phrase, phrase, phrase);
    clauses.push('(e.employee_number::text ILIKE $' + base + ' OR linked.first_name ILIKE $' + (base + 1) + ' OR linked.last_name ILIKE $' + (base + 2) + ' OR linked.email ILIKE $' + (base + 3) + ' OR e.personal_email ILIKE $' + (base + 4) + ')');
  }
  if (query.status) {
    params.push(query.status);
    clauses.push('e.employment_status = $' + params.length);
  }
  if (query.department) {
    params.push('%' + query.department + '%');
    clauses.push('e.department_id::text ILIKE $' + params.length);
  }
  const limit = query.page_size ?? query.limit ?? 100;
  const page = query.page ?? 1;
  params.push(limit, (page - 1) * limit);
  const rows = await db.unsafe(EMPLOYEE_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY e.id LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params);
  return { count: rows.length, employees: rows.map(mapEmployee) };
}

const EMPLOYEE_COLUMN_MAP = {
  user_id: 'user_id',
  recruitment_candidate_id: 'recruitment_candidate_id',
  responsible_id: 'responsible_id',
  base_salary: 'base_salary',
  hire_date: 'hire_date',
  phone: 'phone',
  personal_email: 'personal_email',
  position: 'position',
  department_id: 'department_id',
  description: 'description',
  is_private: 'is_private',
  bank_id: 'bank_id',
  employment_contract_type_id: 'employment_contract_type_id',
  gender_id: 'gender_id',
  civil_status_id: 'civil_status_id',
  rib: 'rib',
  cnss: 'cnss',
  nickname: 'nickname',
  birthdate: 'birthdate',
  id_number: 'id_number',
  address: 'address',
  region: 'region',
  end_date: 'end_date',
  employment_status: 'employment_status',
};

function sqlAssignments(input, columnMap) {
  const entries = Object.entries(input).filter(([key, value]) => key !== 'actor_user_id' && value !== undefined && columnMap[key]);
  const columns = entries.map(([, column]) => '"' + column + '"');
  const values = entries.map(([, value]) => value);
  return { entries, columns, values };
}

async function insertEmployee(db, input) {
  const { columns, values } = sqlAssignments(input, EMPLOYEE_COLUMN_MAP);
  if (!columns.length) throw new Error('No employee fields were supplied.');
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.employees (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  return employeeById(db, Number(rows[0].id));
}

async function updateEmployeeSql(db, id, input) {
  const { columns, values } = sqlAssignments(input, EMPLOYEE_COLUMN_MAP);
  if (!columns.length) throw new Error('No employee fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(id);
  const rows = await db.unsafe('UPDATE public.employees SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Employee not found.');
  return employeeById(db, id);
}

function mapCandidate(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? null,
    appliedPosition: row.applied_position ?? null,
    status: row.status ?? '',
    stage: row.stage == null ? 0 : Number(row.stage),
    location: row.location ?? null,
    spanishLevel: row.spanish_level ?? null,
    createdByName: fullName(row.created_by_first_name, row.created_by_last_name),
    hiredAsEmployeeId: row.hired_as_employee_id == null ? null : Number(row.hired_as_employee_id),
  };
}

const CANDIDATE_SELECT = '  SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.applied_position,\\n'
  + '         c.status, c.stage, c.location, c.spanish_level, c.hired_as_employee_id,\\n'
  + '         creator.first_name AS created_by_first_name, creator.last_name AS created_by_last_name\\n'
  + '    FROM public.recruitment_candidates c\\n'
  + '    LEFT JOIN agent_share.hr_users creator ON creator.id = c.created_by';

async function candidateById(db, id) {
  const rows = await db.unsafe(CANDIDATE_SELECT + ' WHERE c.id = $1 LIMIT 1', [id]);
  return mapCandidate(rows[0]);
}

async function candidatesBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  if (query.search) {
    const base = params.length + 1;
    const phrase = '%' + query.search + '%';
    params.push(phrase, phrase, phrase, phrase);
    clauses.push('(c.first_name ILIKE $' + base + ' OR c.last_name ILIKE $' + (base + 1) + ' OR c.email ILIKE $' + (base + 2) + ' OR c.phone ILIKE $' + (base + 3) + ')');
  }
  if (query.status) {
    params.push(query.status);
    clauses.push('c.status = $' + params.length);
  }
  if (query.position) {
    params.push('%' + query.position + '%');
    clauses.push('c.applied_position ILIKE $' + params.length);
  }
  if (query.spanish_level) {
    params.push(query.spanish_level);
    clauses.push('c.spanish_level = $' + params.length);
  }
  if (query.spanish_review) {
    params.push(query.spanish_review);
    clauses.push("c.spanish_review = $" + params.length);
  }
  const limit = query.limit ?? 100;
  const page = query.page ?? 1;
  params.push(limit, (page - 1) * limit);
  const rows = await db.unsafe(CANDIDATE_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY c.id DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params);
  return { count: rows.length, candidates: rows.map(mapCandidate) };
}

const CANDIDATE_COLUMN_MAP = {
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
  applied_position: 'applied_position',
  expected_salary: 'expected_salary',
  available_from: 'available_from',
  cover_letter: 'cover_letter',
  skills: 'skills',
  experience: 'experience',
  education: 'education',
  location: 'location',
  languages: 'languages',
  notes: 'notes',
  interview_date: 'interview_date',
  interview_notes: 'interview_notes',
  source: 'source',
  rejection_reason: 'rejection_reason',
  status: 'status',
  base_salary: 'base_salary',
  hire_date: 'hire_date',
  position: 'position',
  department: 'department',
};

function candidateSqlInput(input) {
  const copy = { ...input };
  for (const key of ['skills', 'experience', 'education', 'languages']) {
    if (copy[key] !== undefined && typeof copy[key] !== 'string') copy[key] = JSON.stringify(copy[key]);
  }
  return copy;
}

async function insertCandidate(db, input) {
  const { columns, values } = sqlAssignments(candidateSqlInput(input), CANDIDATE_COLUMN_MAP);
  if (!columns.length) throw new Error('No candidate fields were supplied.');
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.recruitment_candidates (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  return candidateById(db, Number(rows[0].id));
}

async function updateCandidateSql(db, id, input) {
  const { columns, values } = sqlAssignments(candidateSqlInput(input), CANDIDATE_COLUMN_MAP);
  if (!columns.length) throw new Error('No candidate fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(id);
  const rows = await db.unsafe('UPDATE public.recruitment_candidates SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Candidate not found.');
  return candidateById(db, id);
}

function mapLeave(row) {
  if (!row) return null;
  const employeeName = fullName(row.employee_first_name, row.employee_last_name);
  const currentApproverName = fullName(row.current_approver_first_name, row.current_approver_last_name);
  const approvedByName = fullName(row.approved_by_first_name, row.approved_by_last_name);
  const coverName = fullName(row.cover_first_name, row.cover_last_name);
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    employee: row.user_id == null ? null : { id: Number(row.user_id), fullName: employeeName, ...(row.employee_email ? { email: row.employee_email } : {}) },
    startDate: asDate(row.start_date),
    endDate: asDate(row.end_date),
    halfDayStart: Boolean(row.half_day_start),
    halfDayEnd: Boolean(row.half_day_end),
    totalDays: row.total_days == null ? '' : row.total_days,
    status: row.status ?? 'pending',
    reason: row.reason ?? null,
    currentApprover: row.current_approver_id == null ? null : { id: Number(row.current_approver_id), fullName: currentApproverName },
    approvedBy: row.approved_by_id == null ? null : { id: Number(row.approved_by_id), fullName: approvedByName },
    coverUser: row.cover_user_id == null ? null : { id: Number(row.cover_user_id), fullName: coverName },
  };
}

const LEAVE_SELECT = '  SELECT r.id, r.user_id, r.start_date, r.end_date, r.half_day_start, r.half_day_end,\\n'
  + '         r.total_days, r.status, r.reason, r.current_approver_id, r.approved_by_id, r.cover_user_id,\\n'
  + '         employee.first_name AS employee_first_name, employee.last_name AS employee_last_name,\\n'
  + '         employee.email AS employee_email,\\n'
  + '         approver.first_name AS current_approver_first_name, approver.last_name AS current_approver_last_name,\\n'
  + '         approved.first_name AS approved_by_first_name, approved.last_name AS approved_by_last_name,\\n'
  + '         cover.first_name AS cover_first_name, cover.last_name AS cover_last_name\\n'
  + '    FROM public.leaves_requests r\\n'
  + '    LEFT JOIN agent_share.hr_users employee ON employee.id = r.user_id\\n'
  + '    LEFT JOIN agent_share.hr_users approver ON approver.id = r.current_approver_id\\n'
  + '    LEFT JOIN agent_share.hr_users approved ON approved.id = r.approved_by_id\\n'
  + '    LEFT JOIN agent_share.hr_users cover ON cover.id = r.cover_user_id';

async function leaveById(db, id) {
  const rows = await db.unsafe(LEAVE_SELECT + ' WHERE r.id = $1 LIMIT 1', [id]);
  return mapLeave(rows[0]);
}

async function leavesBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  if (query.status) {
    params.push(query.status);
    clauses.push('r.status = $' + params.length);
  }
  if (query.user_id) {
    params.push(query.user_id);
    clauses.push('r.user_id = $' + params.length);
  }
  const limit = query.limit ?? 100;
  params.push(limit);
  const rows = await db.unsafe(LEAVE_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY r.id DESC LIMIT $' + params.length, params);
  return { count: rows.length, requests: rows.map(mapLeave) };
}

async function directoryBySearch(db, query) {
  const phrase = '%' + query.q + '%';
  const limit = query.limit ?? 10;
  const rows = await db.unsafe('SELECT id, first_name, last_name, email, is_active FROM agent_share.hr_users WHERE is_active = TRUE AND (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1) ORDER BY id LIMIT $2', [phrase, limit]);
  const users = rows.map((row) => ({
    id: Number(row.id),
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    email: row.email ?? null,
    fullName: fullName(row.first_name, row.last_name),
    isActive: Boolean(row.is_active),
    roleId: null,
    roleName: null,
  }));
  return { query: query.q, count: users.length, users };
}

const LEAVE_COLUMN_MAP = {
  user_id: 'user_id',
  startDate: 'start_date',
  endDate: 'end_date',
  halfDayStart: 'half_day_start',
  halfDayEnd: 'half_day_end',
  reason: 'reason',
  status: 'status',
  coverUserId: 'cover_user_id',
  rejectionReason: 'rejection_reason',
  approvedById: 'approved_by_id',
  coverageNotes: 'coverage_notes',
};

async function insertLeave(db, input) {
  const { columns, values } = sqlAssignments(input, LEAVE_COLUMN_MAP);
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.leaves_requests (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  return leaveById(db, Number(rows[0].id));
}

async function updateLeaveSql(db, id, input) {
  const { columns, values } = sqlAssignments(input, LEAVE_COLUMN_MAP);
  if (!columns.length) throw new Error('No leave fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(id);
  const rows = await db.unsafe('UPDATE public.leaves_requests SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Leave request not found.');
  return leaveById(db, id);
}

async function updateLeaveStatus(db, id, statusValue, input = {}) {
  return updateLeaveSql(db, id, { status: statusValue, ...input });
}

async function referralSearchSql(db, query) {
  const params = [];
  const clauses = ['TRUE'];
  if (query.status) {
    params.push(query.status);
    clauses.push('r.status = $' + params.length);
  }
  params.push(100);
  const rows = await db.unsafe('SELECT r.id, r.status, r.referrer_id, r.candidate_id, referrer.first_name AS referrer_first_name, referrer.last_name AS referrer_last_name, candidate.first_name AS candidate_first_name, candidate.last_name AS candidate_last_name FROM public.referrals r LEFT JOIN agent_share.hr_users referrer ON referrer.id = r.referrer_id LEFT JOIN public.recruitment_candidates candidate ON candidate.id = r.candidate_id WHERE ' + clauses.join(' AND ') + ' ORDER BY r.id DESC LIMIT $' + params.length, params);
  return {
    count: rows.length,
    referrals: rows.map((row) => ({
      id: Number(row.id),
      status: row.status ?? null,
      referrer: row.referrer_id == null ? null : { id: Number(row.referrer_id), fullName: fullName(row.referrer_first_name, row.referrer_last_name) },
      candidate: row.candidate_id == null ? null : { id: Number(row.candidate_id), fullName: fullName(row.candidate_first_name, row.candidate_last_name) },
    })),
  };
}

export async function searchDirectoryUsers(input) {
  const query = directorySearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/directory/users', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'agent_share.hr_users', (db) => directoryBySearch(db, query));
  }
}

export async function getEmployee(employeeId) {
  const id = positiveInt.parse(employeeId);
  try {
    return await request('GET', '/hr/llm/employees/' + id);
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.employees', (db) => employeeById(db, id));
  }
}

export async function searchEmployees(input = {}) {
  const query = employeeSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/employees/search', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.employees', (db) => employeesBySearch(db, query));
  }
}

export async function createEmployee(input) {
  const normalized = await normalizeEmployeeCreateInput(input);
  const body = withActor(employeeCreateInput.parse(normalized));
  try {
    return await request('POST', '/hr/llm/actions/employees', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.employees', (db) => insertEmployee(db, body));
  }
}

export async function createEmployeeFromUser(input) {
  const normalized = await normalizeEmployeeFromUserInput(input);
  const body = withActor(employeeFromUserInput.parse(normalized));
  try {
    return await request('POST', '/hr/llm/actions/employees/from-user', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.employees', (db) => insertEmployee(db, body));
  }
}

export async function updateEmployee(employeeId, input) {
  const id = positiveInt.parse(employeeId);
  const normalized = await normalizeEmployeePatchInput(input);
  const body = withActor(employeePatchInput.parse(normalized));
  try {
    return await request('PATCH', '/hr/llm/actions/employees/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.employees', (db) => updateEmployeeSql(db, id, body));
  }
}

export async function getCandidate(candidateId) {
  const id = positiveInt.parse(candidateId);
  try {
    return await request('GET', '/hr/llm/recruitment/candidates/' + id);
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => candidateById(db, id));
  }
}

export async function searchCandidates(input = {}) {
  const query = candidateSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/recruitment/candidates/search', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => candidatesBySearch(db, query));
  }
}

export async function createCandidate(input) {
  const body = withActor(candidateCreateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/recruitment/candidates', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => insertCandidate(db, body));
  }
}

export async function updateCandidate(candidateId, input) {
  const id = positiveInt.parse(candidateId);
  const body = withActor(candidatePatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/recruitment/candidates/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => updateCandidateSql(db, id, body));
  }
}

export async function moveCandidateStage(candidateId, input) {
  const id = positiveInt.parse(candidateId);
  const body = withActor(candidateMoveStageInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/recruitment/candidates/' + id + '/move-stage', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => moveCandidateStageSql(db, id, body));
  }
}

export async function rejectCandidate(candidateId, input) {
  const id = positiveInt.parse(candidateId);
  const body = withActor(candidateRejectInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/recruitment/candidates/' + id + '/reject', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => updateCandidateSql(db, id, { status: 'rejected', rejection_reason: body.rejection_reason }));
  }
}

export async function hireCandidate(candidateId, input) {
  const id = positiveInt.parse(candidateId);
  const body = withActor(candidateHireInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/recruitment/candidates/' + id + '/hire', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.recruitment_candidates', (db) => updateCandidateSql(db, id, { status: 'hired', base_salary: body.base_salary, hire_date: body.hire_date, position: body.position, department: body.department }));
  }
}

export async function searchLeaves(input = {}) {
  const normalized = await normalizeLeaveSearchInput(input);
  const query = leaveSearchInput.parse(normalized);
  try {
    return await request('GET', '/hr/llm/leaves/requests/search', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => leavesBySearch(db, query));
  }
}

export async function getLeave(leaveId) {
  const id = positiveInt.parse(leaveId);
  try {
    return await request('GET', '/hr/llm/leaves/requests/' + id);
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => leaveById(db, id));
  }
}

export async function createLeave(input) {
  const normalized = await normalizeLeaveCreateInput(input);
  const body = withActor(leaveCreateInput.parse(normalized));
  try {
    return await request('POST', '/hr/llm/actions/leaves/requests', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => insertLeave(db, body));
  }
}

export async function updateLeave(leaveId, input) {
  const id = positiveInt.parse(leaveId);
  const body = withActor(leavePatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/leaves/requests/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => updateLeaveSql(db, id, body));
  }
}

export async function approveLeave(leaveId, input) {
  const id = positiveInt.parse(leaveId);
  const normalized = await normalizeLeaveApproveInput(input);
  const body = withActor(leaveApproveInput.parse(normalized));
  try {
    return await request('POST', '/hr/llm/actions/leaves/requests/' + id + '/approve', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => updateLeaveStatus(db, id, 'approved', { coverUserId: body.coverUserId }));
  }
}

export async function rejectLeave(leaveId, input) {
  const id = positiveInt.parse(leaveId);
  const body = withActor(leaveRejectInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/leaves/requests/' + id + '/reject', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => updateLeaveStatus(db, id, 'rejected', { rejectionReason: body.rejectionReason }));
  }
}

export async function cancelLeave(leaveId, input) {
  const id = positiveInt.parse(leaveId);
  const body = withActor(leaveCancelInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/leaves/requests/' + id + '/cancel', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_requests', (db) => updateLeaveStatus(db, id, 'cancelled'));
  }
}

export async function adjustLeaveBalance(input) {
  const normalized = await normalizeLeaveBalanceInput(input);
  const body = withActor(leaveBalanceAdjustInput.parse(normalized));
  try {
    return await request('POST', '/hr/llm/actions/leaves/balance/adjust', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leaves_balance_adjustments', async (db) => {
      const rows = await db.unsafe('INSERT INTO public.leaves_balance_adjustments (user_id, amount, reason, actor_user_id) VALUES ($1, $2, $3, $4) RETURNING id, user_id, amount, reason', [body.user_id, body.amount, body.reason, body.actor_user_id]);
      return rows[0] ?? null;
    });
  }
}

export async function searchReferrals(input = {}) {
  const query = referralSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/referrals/search', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.referrals', (db) => referralSearchSql(db, query));
  }
}

export async function markReferralPaid(referralId, half, input) {
  const id = positiveInt.parse(referralId);
  const halfValue = z.enum(['first', 'second']).parse(half);
  const body = withActor(referralMarkPaidInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/referrals/' + id + '/mark-paid/' + halfValue, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    const column = halfValue === 'first' ? 'first_half_paid' : 'second_half_paid';
    return sqlFallback(error, 'public.referrals', async (db) => {
      const rows = await db.unsafe('UPDATE public.referrals SET ' + column + ' = TRUE WHERE id = $1 RETURNING id, status', [id]);
      return rows[0] ? { id: Number(rows[0].id), status: rows[0].status ?? null, [column]: true } : null;
    });
  }
}

export async function cancelReferral(referralId, input) {
  const id = positiveInt.parse(referralId);
  const body = withActor(referralCancelInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/referrals/' + id + '/cancel', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.referrals', async (db) => {
      const rows = await db.unsafe('UPDATE public.referrals SET status = \'cancelled\', cancellation_reason = $2 WHERE id = $1 RETURNING id, status', [id, body.reason]);
      return rows[0] ? { id: Number(rows[0].id), status: rows[0].status } : null;
    });
  }
}

export async function reinstateReferral(referralId, input) {
  const id = positiveInt.parse(referralId);
  const body = withActor(referralReinstateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/referrals/' + id + '/reinstate', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.referrals', async (db) => {
      const rows = await db.unsafe('UPDATE public.referrals SET status = \'owed\' WHERE id = $1 RETURNING id, status', [id]);
      return rows[0] ? { id: Number(rows[0].id), status: rows[0].status } : null;
    });
  }
}
async function moveCandidateStageSql(db, id, input) {
  const assignments = ["stage = COALESCE(stage, 0) + 1"];
  const values = [];
  const optional = { notes: "notes", interview_date: "interview_date", interview_notes: "interview_notes" };
  for (const [key, column] of Object.entries(optional)) {
    if (input[key] !== undefined) {
      values.push(input[key]);
      assignments.push(column + " = $" + values.length);
    }
  }
  values.push(id);
  const rows = await db.unsafe("UPDATE public.recruitment_candidates SET " + assignments.join(", ") + " WHERE id = $" + values.length + " RETURNING id", values);
  if (!rows[0]) throw new Error("Candidate not found.");
  return candidateById(db, id);
}


function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapPayrollRun(row) {
  if (!row) return null;
  const approvedById = row.approved_by_id == null ? null : Number(row.approved_by_id);
  return {
    id: Number(row.id),
    month: Number(row.month),
    year: Number(row.year),
    workingDays: numberOrNull(row.working_days),
    status: row.status ?? 'draft',
    approvedBy: approvedById == null ? null : {
      id: approvedById,
      fullName: fullName(row.approved_by_first_name, row.approved_by_last_name),
    },
    approvedAt: asDate(row.approved_at),
    paidAt: asDate(row.paid_at),
    totalGross: numberOrNull(row.total_gross),
    totalNet: numberOrNull(row.total_net),
    invoiceAmount: numberOrNull(row.invoice_amount),
    invoiceNumber: row.invoice_number ?? null,
  };
}

const PAYROLL_RUN_SELECT = 'SELECT p.id, p.month, p.year, p.working_days, p.status, p.approved_by_id, p.approved_at, p.paid_at, p.total_gross, p.total_net, p.invoice_amount, p.invoice_number, approved.first_name AS approved_by_first_name, approved.last_name AS approved_by_last_name FROM public.payroll_runs p LEFT JOIN agent_share.hr_users approved ON approved.id = p.approved_by_id';

const PAYROLL_ENTRY_SELECT = 'SELECT pe.id, pe.employee_id, pe.days_worked, pe.sick_days, pe.absent_days, pe.prima, pe.prime_anciennete, pe.salaire_brut, pe.salaire, pe.fp, pe.cnss, pe.amo, pe.sni, pe.igr_brut, pe.p_charges, pe.igr_net, pe.total_retenues, pe.salaire_net, pe.net_a_payer, linked.first_name AS employee_first_name, linked.last_name AS employee_last_name FROM public.payroll_entries pe LEFT JOIN public.employees employee ON employee.id = pe.employee_id LEFT JOIN agent_share.hr_users linked ON linked.id = employee.user_id';

function mapPayrollEntry(row) {
  if (!row) return null;
  const employeeId = row.employee_id == null ? null : Number(row.employee_id);
  return {
    id: Number(row.id),
    employeeId,
    employee: employeeId == null ? null : {
      id: employeeId,
      fullName: fullName(row.employee_first_name, row.employee_last_name),
    },
    daysWorked: numberOrNull(row.days_worked),
    sickDays: numberOrNull(row.sick_days),
    absentDays: numberOrNull(row.absent_days),
    prima: numberOrNull(row.prima),
    primeAnciennete: numberOrNull(row.prime_anciennete),
    salaireBrut: numberOrNull(row.salaire_brut),
    salaire: numberOrNull(row.salaire),
    fp: numberOrNull(row.fp),
    cnss: numberOrNull(row.cnss),
    amo: numberOrNull(row.amo),
    sni: numberOrNull(row.sni),
    igrBrut: numberOrNull(row.igr_brut),
    pCharges: numberOrNull(row.p_charges),
    igrNet: numberOrNull(row.igr_net),
    totalRetenues: numberOrNull(row.total_retenues),
    salaireNet: numberOrNull(row.salaire_net),
    netAPayer: numberOrNull(row.net_a_payer),
  };
}

async function payrollRunById(db, id) {
  const runs = await db.unsafe(PAYROLL_RUN_SELECT + ' WHERE p.id = $1 LIMIT 1', [id]);
  const run = mapPayrollRun(runs[0]);
  if (!run) return null;
  const entries = await db.unsafe(PAYROLL_ENTRY_SELECT + ' WHERE pe.payroll_run_id = $1 ORDER BY pe.id', [id]);
  return { ...run, entries: entries.map(mapPayrollEntry) };
}

async function payrollRunsBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  if (query.month !== undefined) {
    params.push(query.month);
    clauses.push('p.month = $' + params.length);
  }
  if (query.year !== undefined) {
    params.push(query.year);
    clauses.push('p.year = $' + params.length);
  }
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const rows = await db.unsafe(PAYROLL_RUN_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY p.year DESC, p.month DESC, p.id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2), [...params, limit, offset]);
  const totals = await db.unsafe('SELECT COUNT(*)::int AS total FROM public.payroll_runs p WHERE ' + clauses.join(' AND '), params);
  return {
    runs: rows.map(mapPayrollRun),
    total: Number(totals[0]?.total ?? rows.length),
  };
}

async function insertPayrollRun(db, input) {
  const existing = await db.unsafe('SELECT id FROM public.payroll_runs WHERE month = $1 AND year = $2 LIMIT 1', [input.month, input.year]);
  if (existing[0]) return payrollRunById(db, Number(existing[0].id));
  const columns = ['month', 'year'];
  const values = [input.month, input.year];
  if (input.workingDays !== undefined) {
    columns.push('working_days');
    values.push(input.workingDays);
  }
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.payroll_runs (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  return payrollRunById(db, Number(rows[0].id));
}

async function calculatePayrollRunSql(db, id) {
  const run = await payrollRunById(db, id);
  if (!run) throw new Error('Payroll run not found.');
  await db.unsafe('UPDATE public.payroll_entries AS pe SET days_worked = GREATEST(COALESCE((SELECT working_days FROM public.payroll_runs WHERE id = $1), 0) - COALESCE(pe.sick_days, 0) - COALESCE(pe.absent_days, 0), 0) WHERE pe.payroll_run_id = $1', [id]);
  return payrollRunById(db, id);
}

const PAYROLL_ENTRY_COLUMN_MAP = {
  sickDays: 'sick_days',
  absentDays: 'absent_days',
  prima: 'prima',
  primeAnciennete: 'prime_anciennete',
};

async function updatePayrollEntrySql(db, runId, employeeId, input) {
  const assignments = [];
  const values = [];
  for (const [key, column] of Object.entries(PAYROLL_ENTRY_COLUMN_MAP)) {
    if (input[key] !== undefined) {
      values.push(input[key]);
      assignments.push(column + ' = $' + values.length);
    }
  }
  if (!assignments.length) throw new Error('No payroll entry fields were supplied.');
  values.push(runId, employeeId);
  const runPlaceholder = values.length - 1;
  const employeePlaceholder = values.length;
  const rows = await db.unsafe('UPDATE public.payroll_entries SET ' + assignments.join(', ') + ' WHERE payroll_run_id = $' + runPlaceholder + ' AND employee_id = $' + employeePlaceholder + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Payroll entry not found.');
  await db.unsafe('UPDATE public.payroll_entries AS pe SET days_worked = GREATEST(COALESCE((SELECT working_days FROM public.payroll_runs WHERE id = $1), 0) - COALESCE(pe.sick_days, 0) - COALESCE(pe.absent_days, 0), 0) WHERE pe.payroll_run_id = $1 AND pe.employee_id = $2', [runId, employeeId]);
  return payrollRunById(db, runId);
}

async function approvePayrollRunSql(db, id, input) {
  const assignments = ['status = $1', 'approved_by_id = $2', 'approved_at = CURRENT_TIMESTAMP'];
  const values = ['approved', input.actor_user_id];
  if (input.invoiceNumber !== undefined) {
    values.push(input.invoiceNumber);
    assignments.push('invoice_number = $' + values.length);
  }
  if (input.invoiceAmount !== undefined) {
    values.push(input.invoiceAmount);
    assignments.push('invoice_amount = $' + values.length);
  }
  values.push(id);
  const rows = await db.unsafe('UPDATE public.payroll_runs SET ' + assignments.join(', ') + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Payroll run not found.');
  return payrollRunById(db, id);
}

async function markPayrollRunPaidSql(db, id) {
  const rows = await db.unsafe('UPDATE public.payroll_runs SET status = $1, paid_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id', ['paid', id]);
  if (!rows[0]) throw new Error('Payroll run not found.');
  return payrollRunById(db, id);
}

async function deletePayrollRunSql(db, id) {
  const rows = await db.unsafe('DELETE FROM public.payroll_entries WHERE payroll_run_id = $1', [id]);
  void rows;
  const deleted = await db.unsafe('DELETE FROM public.payroll_runs WHERE id = $1 RETURNING id', [id]);
  if (!deleted[0]) throw new Error('Payroll run not found.');
  return { id: Number(deleted[0].id), status: 'deleted' };
}

function mapPayrollConfig(row) {
  if (!row) return null;
  return {
    fpRate: numberOrNull(row.fp_rate),
    fpCap: numberOrNull(row.fp_cap),
    fpRateReduced: numberOrNull(row.fp_rate_reduced),
    fpThreshold: numberOrNull(row.fp_threshold),
    cnssRate: numberOrNull(row.cnss_rate),
    cnssCap: numberOrNull(row.cnss_cap),
    amoRate: numberOrNull(row.amo_rate),
    childDeduction: numberOrNull(row.child_deduction),
    defaultWorkingDays: numberOrNull(row.default_working_days),
    maxChildrenDeduction: numberOrNull(row.max_children_deduction),
    igrBrackets: jsonValue(row.igr_brackets, []),
    seniorityBrackets: jsonValue(row.seniority_brackets, []),
  };
}

const PAYROLL_CONFIG_SELECT = 'SELECT id, fp_rate, fp_cap, fp_rate_reduced, fp_threshold, cnss_rate, cnss_cap, amo_rate, child_deduction, default_working_days, max_children_deduction, igr_brackets, seniority_brackets FROM public.payroll_config';

async function payrollConfigById(db, id) {
  const rows = await db.unsafe(PAYROLL_CONFIG_SELECT + ' WHERE id = $1 LIMIT 1', [id]);
  return mapPayrollConfig(rows[0]);
}

async function payrollConfigSql(db) {
  const rows = await db.unsafe(PAYROLL_CONFIG_SELECT + ' ORDER BY id LIMIT 1');
  return mapPayrollConfig(rows[0]);
}

const PAYROLL_CONFIG_COLUMN_MAP = {
  fpRate: 'fp_rate',
  fpCap: 'fp_cap',
  fpRateReduced: 'fp_rate_reduced',
  fpThreshold: 'fp_threshold',
  cnssRate: 'cnss_rate',
  cnssCap: 'cnss_cap',
  amoRate: 'amo_rate',
  childDeduction: 'child_deduction',
  defaultWorkingDays: 'default_working_days',
  maxChildrenDeduction: 'max_children_deduction',
  igrBrackets: 'igr_brackets',
  seniorityBrackets: 'seniority_brackets',
};

function payrollConfigSqlInput(input) {
  const copy = { ...input };
  for (const key of ['igrBrackets', 'seniorityBrackets']) {
    if (copy[key] !== undefined) copy[key] = JSON.stringify(copy[key]);
  }
  return copy;
}

async function updatePayrollConfigSql(db, input) {
  const existing = await db.unsafe('SELECT id FROM public.payroll_config ORDER BY id LIMIT 1');
  const converted = payrollConfigSqlInput(input);
  if (!existing[0]) {
    const { columns, values } = sqlAssignments(converted, PAYROLL_CONFIG_COLUMN_MAP);
    if (!columns.length) throw new Error('No payroll config fields were supplied.');
    const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
    const rows = await db.unsafe('INSERT INTO public.payroll_config (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
    return payrollConfigById(db, Number(rows[0].id));
  }
  const { columns, values } = sqlAssignments(converted, PAYROLL_CONFIG_COLUMN_MAP);
  if (!columns.length) throw new Error('No payroll config fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(Number(existing[0].id));
  const rows = await db.unsafe('UPDATE public.payroll_config SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  return payrollConfigById(db, Number(rows[0].id));
}

function mapExpense(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    category: row.category ?? '',
    periodMonth: numberOrNull(row.period_month),
    periodYear: numberOrNull(row.period_year),
    vendorName: row.vendor_name ?? '',
    totalAmount: numberOrNull(row.total_amount),
    concept: row.concept ?? null,
    currency: row.currency ?? null,
    invoiceNumber: row.invoice_number ?? null,
    issueDate: asDate(row.issue_date),
    notes: row.notes ?? null,
    status: row.status ?? 'confirmed',
  };
}

const EXPENSE_SELECT = 'SELECT id, category, period_month, period_year, vendor_name, total_amount, concept, currency, invoice_number, issue_date, notes, status FROM public.expense_entries';

async function expensesBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  params.push(query.month);
  clauses.push('period_month = $' + params.length);
  params.push(query.year);
  clauses.push('period_year = $' + params.length);
  if (query.category) {
    params.push(query.category);
    clauses.push('category = $' + params.length);
  }
  if (query.status) {
    params.push(query.status);
    clauses.push('status = $' + params.length);
  }
  const rows = await db.unsafe(EXPENSE_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY id DESC', params);
  const expenses = rows.map(mapExpense);
  const byCategory = [];
  const grouped = new Map();
  for (const expense of expenses) {
    const amount = Number(expense.totalAmount) || 0;
    grouped.set(expense.category, (grouped.get(expense.category) || 0) + amount);
  }
  for (const [category, total] of grouped) byCategory.push({ category, total });
  return {
    month: query.month,
    year: query.year,
    expenses,
    byCategory,
    total: expenses.reduce((sum, expense) => sum + (Number(expense.totalAmount) || 0), 0),
  };
}

const EXPENSE_COLUMN_MAP = {
  category: 'category',
  period_month: 'period_month',
  period_year: 'period_year',
  vendor_name: 'vendor_name',
  total_amount: 'total_amount',
  concept: 'concept',
  currency: 'currency',
  invoice_number: 'invoice_number',
  issue_date: 'issue_date',
  notes: 'notes',
  status: 'status',
};

async function insertExpense(db, input) {
  const { columns, values } = sqlAssignments({ ...input, status: 'confirmed' }, EXPENSE_COLUMN_MAP);
  if (!columns.length) throw new Error('No expense fields were supplied.');
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.expense_entries (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  const selected = await db.unsafe(EXPENSE_SELECT + ' WHERE id = $1 LIMIT 1', [Number(rows[0].id)]);
  return mapExpense(selected[0]);
}

async function updateExpenseSql(db, id, input) {
  const { columns, values } = sqlAssignments(input, EXPENSE_COLUMN_MAP);
  if (!columns.length) throw new Error('No expense fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(id);
  const rows = await db.unsafe('UPDATE public.expense_entries SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Expense not found.');
  const selected = await db.unsafe(EXPENSE_SELECT + ' WHERE id = $1 LIMIT 1', [id]);
  return mapExpense(selected[0]);
}

async function deleteExpenseSql(db, id) {
  const rows = await db.unsafe('DELETE FROM public.expense_entries WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) throw new Error('Expense not found.');
  return { id: Number(rows[0].id), status: 'deleted' };
}

function mapExpenseTemplate(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    category: row.category ?? '',
    vendorName: row.vendor_name ?? '',
    amount: numberOrNull(row.amount),
    concept: row.concept ?? null,
    currency: row.currency ?? null,
    isActive: row.is_active == null ? null : Boolean(row.is_active),
    notes: row.notes ?? null,
  };
}

const EXPENSE_TEMPLATE_SELECT = 'SELECT id, category, vendor_name, amount, concept, currency, is_active, notes FROM public.expense_templates';

async function expenseTemplatesBySearch(db, query) {
  const clauses = ['TRUE'];
  const params = [];
  if (query.active !== undefined) {
    params.push(query.active);
    clauses.push('is_active = $' + params.length);
  }
  const rows = await db.unsafe(EXPENSE_TEMPLATE_SELECT + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY id DESC', params);
  return { count: rows.length, templates: rows.map(mapExpenseTemplate) };
}

const EXPENSE_TEMPLATE_COLUMN_MAP = {
  category: 'category',
  vendor_name: 'vendor_name',
  amount: 'amount',
  concept: 'concept',
  currency: 'currency',
  is_active: 'is_active',
  notes: 'notes',
};

async function insertExpenseTemplateSql(db, input) {
  const converted = { ...input, is_active: input.is_active === undefined ? true : input.is_active };
  const { columns, values } = sqlAssignments(converted, EXPENSE_TEMPLATE_COLUMN_MAP);
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ');
  const rows = await db.unsafe('INSERT INTO public.expense_templates (' + columns.join(', ') + ') VALUES (' + placeholders + ') RETURNING id', values);
  const selected = await db.unsafe(EXPENSE_TEMPLATE_SELECT + ' WHERE id = $1 LIMIT 1', [Number(rows[0].id)]);
  return mapExpenseTemplate(selected[0]);
}

async function updateExpenseTemplateSql(db, id, input) {
  const converted = { ...input };
  const { columns, values } = sqlAssignments(converted, EXPENSE_TEMPLATE_COLUMN_MAP);
  if (!columns.length) throw new Error('No expense template fields were supplied.');
  const assignments = columns.map((column, index) => column + ' = $' + (index + 1)).join(', ');
  values.push(id);
  const rows = await db.unsafe('UPDATE public.expense_templates SET ' + assignments + ' WHERE id = $' + values.length + ' RETURNING id', values);
  if (!rows[0]) throw new Error('Expense template not found.');
  const selected = await db.unsafe(EXPENSE_TEMPLATE_SELECT + ' WHERE id = $1 LIMIT 1', [id]);
  return mapExpenseTemplate(selected[0]);
}

async function deleteExpenseTemplateSql(db, id) {
  const rows = await db.unsafe('DELETE FROM public.expense_templates WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) throw new Error('Expense template not found.');
  return { id: Number(rows[0].id), status: 'deleted' };
}

async function generateExpensesSql(db, input) {
  await db.unsafe("INSERT INTO public.expense_entries (category, period_month, period_year, vendor_name, total_amount, concept, currency, status, notes) SELECT category, $1, $2, vendor_name, amount, concept, currency, 'draft', notes FROM public.expense_templates WHERE is_active = TRUE", [input.month, input.year]);
  return expensesBySearch(db, { month: input.month, year: input.year });
}

export async function listPayrollRuns(input = {}) {
  const query = payrollRunsSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/payroll/runs', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => payrollRunsBySearch(db, query));
  }
}

export async function getPayrollRun(runId) {
  const id = positiveInt.parse(runId);
  try {
    return await request('GET', '/hr/llm/payroll/runs/' + id);
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => payrollRunById(db, id));
  }
}

export async function createPayrollRun(input) {
  const body = withActor(payrollRunCreateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/payroll/runs', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => insertPayrollRun(db, body));
  }
}

export async function calculatePayrollRun(runId, input) {
  const id = positiveInt.parse(runId);
  const body = withActor(payrollActorInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/payroll/runs/' + id + '/calculate', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => calculatePayrollRunSql(db, id));
  }
}

export async function updatePayrollEntry(runId, employeeId, input) {
  const id = positiveInt.parse(runId);
  const employee = positiveInt.parse(employeeId);
  const body = withActor(payrollEntryPatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/payroll/runs/' + id + '/entries/' + employee, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_entries', (db) => updatePayrollEntrySql(db, id, employee, body));
  }
}

export async function approvePayrollRun(runId, input) {
  const id = positiveInt.parse(runId);
  const body = withActor(payrollApproveInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/payroll/runs/' + id + '/approve', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => approvePayrollRunSql(db, id, body));
  }
}

export async function markPayrollRunPaid(runId, input) {
  const id = positiveInt.parse(runId);
  const body = withActor(payrollConfirmInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/payroll/runs/' + id + '/mark-paid', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => markPayrollRunPaidSql(db, id));
  }
}

export async function deletePayrollRun(runId, input) {
  const id = positiveInt.parse(runId);
  const body = withActor(payrollConfirmInput.parse(input));
  try {
    return await request('DELETE', '/hr/llm/actions/payroll/runs/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_runs', (db) => deletePayrollRunSql(db, id));
  }
}

export async function getPayrollConfig() {
  try {
    return await request('GET', '/hr/llm/payroll/config');
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_config', (db) => payrollConfigSql(db));
  }
}

export async function updatePayrollConfig(input) {
  const body = withActor(payrollConfigPatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/payroll/config', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.payroll_config', (db) => updatePayrollConfigSql(db, body));
  }
}

export async function listExpenses(input) {
  const query = expenseSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/expenses', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_entries', (db) => expensesBySearch(db, query));
  }
}

export async function createExpense(input) {
  const body = withActor(expenseCreateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/expenses', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_entries', (db) => insertExpense(db, body));
  }
}

export async function updateExpense(expenseId, input) {
  const id = positiveInt.parse(expenseId);
  const body = withActor(expensePatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/expenses/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_entries', (db) => updateExpenseSql(db, id, body));
  }
}

export async function deleteExpense(expenseId, input) {
  const id = positiveInt.parse(expenseId);
  const body = withActor(expenseDeleteInput.parse(input));
  try {
    return await request('DELETE', '/hr/llm/actions/expenses/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_entries', (db) => deleteExpenseSql(db, id));
  }
}

export async function generateExpenses(input) {
  const body = withActor(expenseGenerateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/expenses/generate', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_entries', (db) => generateExpensesSql(db, body));
  }
}

export async function listExpenseTemplates(input = {}) {
  const query = expenseTemplateSearchInput.parse(input);
  try {
    return await request('GET', '/hr/llm/expenses/templates', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_templates', (db) => expenseTemplatesBySearch(db, query));
  }
}

export async function createExpenseTemplate(input) {
  const body = withActor(expenseTemplateCreateInput.parse(input));
  try {
    return await request('POST', '/hr/llm/actions/expenses/templates', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_templates', (db) => insertExpenseTemplateSql(db, body));
  }
}

export async function updateExpenseTemplate(templateId, input) {
  const id = positiveInt.parse(templateId);
  const body = withActor(expenseTemplatePatchInput.parse(input));
  try {
    return await request('PATCH', '/hr/llm/actions/expenses/templates/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_templates', (db) => updateExpenseTemplateSql(db, id, body));
  }
}

export async function deleteExpenseTemplate(templateId, input) {
  const id = positiveInt.parse(templateId);
  const body = withActor(expenseDeleteInput.parse(input));
  try {
    return await request('DELETE', '/hr/llm/actions/expenses/templates/' + id, { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.expense_templates', (db) => deleteExpenseTemplateSql(db, id));
  }
}
