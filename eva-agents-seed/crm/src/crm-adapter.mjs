import dotenv from 'dotenv';
import { appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq, ilike, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { crmUsers, leads } from './schema.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(workspaceRoot, '.env.crm-bootstrap');
const gapLogPath = resolve(workspaceRoot, 'sql', 'http-gaps.md');
dotenv.config({ path: envPath, quiet: true });

const SQL_ALLOWED_TABLES = new Set(['public.leads', 'agent_share.crm_users']);

class HttpRouteError extends Error {
  constructor({ method, path, reason, status }) {
    super(`${method} ${path}: ${reason}`);
    this.method = method;
    this.path = path;
    this.reason = reason;
    this.status = status;
  }
}

const createLeadInput = z.object({
  actor_user_id: z.coerce.number().int().positive(),
  confirmed: z.literal(true),
  name: z.string().trim().min(1).max(60),
  email: z.string().email(),
  phone: z.string().transform((value) => value.replace(/\D/g, '')).pipe(z.string().min(7).max(15)),
  company_id: z.coerce.number().int().positive().optional(),
  user_id: z.coerce.number().int().positive().optional(),
  interest: z.string().trim().min(1).optional(),
  campaign: z.string().trim().min(1).optional(),
  idempotency_key: z.string().min(8).max(120).optional(),
}).strict();

const rollbackLeadInput = z.object({
  lead_id: z.coerce.number().int().positive(),
  actor_user_id: z.coerce.number().int().positive(),
  confirmed: z.literal(true),
}).strict();

const directoryUserSearchInput = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(25).optional(),
}).strict();

function erpBaseUrl() {
  const value = process.env.ERP_BASE_URL;
  if (!value) throw new HttpRouteError({ method: 'GET', path: '/crm/llm', reason: 'ERP_BASE_URL is not configured' });
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function erpKey() {
  const value = process.env.ERP_KEY;
  if (!value) throw new HttpRouteError({ method: 'GET', path: '/crm/llm', reason: 'ERP_KEY is not configured' });
  return value;
}

function sqlUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is not configured for the allowed CRM SQL fallback.');
  return value;
}

function buildUrl(path, query) {
  const url = new URL(`${erpBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function requestYaml(method, path, { query, body, jsonResponse = false } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        'X-ERP-Key': erpKey(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new HttpRouteError({ method, path, reason: error.name === 'TimeoutError' ? 'timeout' : 'network failure' });
  }

  const payload = await response.text();
  if (!response.ok) {
    throw new HttpRouteError({ method, path, status: response.status, reason: `HTTP ${response.status}` });
  }

  try {
    const parsed = jsonResponse ? JSON.parse(payload) : parseYaml(payload);
    if (parsed === null || typeof parsed !== 'object') throw new Error('unexpected payload shape');
    return parsed;
  } catch {
    throw new HttpRouteError({ method, path, status: response.status, reason: 'invalid success payload' });
  }
}

function assertSqlAllowed(table) {
  if (!SQL_ALLOWED_TABLES.has(table)) throw new Error(`SQL fallback denied for ${table}.`);
}

async function recordHttpGap({ method, path, reason, table }) {
  const timestamp = new Date().toISOString();
  await appendFile(gapLogPath, `\n- ${timestamp} — ${method} ${path}; ${reason}; SQL fallback: ${table}. Ask ERP to add/fix the /crm/llm route.\n`);
}

function runBackup() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolve(workspaceRoot, 'bin', 'crm-backup'), [], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`CRM backup failed with exit code ${code}.`));
    });
  });
}

async function withSqlTransaction(work, { backup = false } = {}) {
  if (backup) await runBackup();
  const client = postgres(sqlUrl(), { max: 1, prepare: false });
  try {
    return await drizzle(client).transaction(work);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function sqlFallback(error, table, work, { backup = false } = {}) {
  assertSqlAllowed(table);
  const result = await withSqlTransaction(work, { backup });
  await recordHttpGap({ method: error.method, path: error.path, reason: error.reason, table });
  return result;
}

export async function getLead(leadId) {
  const id = z.coerce.number().int().positive().parse(leadId);
  try {
    return await requestYaml('GET', `/crm/llm/leads/${id}`);
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leads', async (db) => {
      const [lead] = await db.select({
        id: leads.id,
        userId: leads.userId,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        campaign: leads.campaign,
        interest: leads.interest,
        isActive: leads.isActive,
        createdAt: leads.createdAt,
        updatedAt: leads.updatedAt,
      }).from(leads).where(eq(leads.id, id)).limit(1);
      return lead ?? null;
    });
  }
}

export async function findUsers(input) {
  const query = directoryUserSearchInput.parse(input);
  try {
    return await requestYaml('GET', '/crm/llm/directory/users', { query });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'agent_share.crm_users', async (db) => {
      const phrase = '%' + query.q + '%';
      const users = await db.select({
        id: crmUsers.id,
        firstName: crmUsers.firstName,
        lastName: crmUsers.lastName,
        email: crmUsers.email,
        isActive: crmUsers.isActive,
      }).from(crmUsers).where(and(
        eq(crmUsers.isActive, true),
        or(ilike(crmUsers.email, phrase), ilike(crmUsers.firstName, phrase), ilike(crmUsers.lastName, phrase)),
      )).limit(query.limit ?? 10);
      return {
        query: query.q,
        count: users.length,
        users: users.map((user) => ({ ...user, fullName: [user.firstName, user.lastName].filter(Boolean).join(' ') })),
      };
    });
  }
}

export async function createLead(input) {
  const values = createLeadInput.parse(input);
  const { confirmed: _confirmed, ...body } = values;
  try {
    return await requestYaml('POST', '/crm/llm/actions/leads', { body });
  } catch (error) {
    if (!(error instanceof HttpRouteError)) throw error;
    return sqlFallback(error, 'public.leads', async (db) => {
      const [existing] = await db.select({
        id: leads.id,
        userId: leads.userId,
        name: leads.name,
        email: leads.email,
        createdAt: leads.createdAt,
      }).from(leads).where(eq(leads.email, body.email)).limit(1);
      if (existing) return { ...existing, idempotentReplay: true };

      const [lead] = await db.insert(leads).values({
        email: body.email,
        name: body.name,
        phone: body.phone,
        userId: body.user_id,
        companyId: body.company_id,
        campaign: body.campaign,
        interest: body.interest,
        isActive: false,
        sendMarketingEmails: false,
      }).returning({ id: leads.id, userId: leads.userId, name: leads.name, email: leads.email, createdAt: leads.createdAt });
      return lead;
    }, { backup: true });
  }
}

export async function rollbackLead(input) {
  const { lead_id, actor_user_id: _actorUserId, confirmed: _confirmed } = rollbackLeadInput.parse(input);
  const missingRoute = new HttpRouteError({
    method: 'PATCH',
    path: '/crm/llm/actions/leads/:id/rollback',
    reason: 'no documented HTTP rollback route',
  });
  return sqlFallback(missingRoute, 'public.leads', async (db) => {
    const [lead] = await db.update(leads).set({
      isActive: false,
      sendMarketingEmails: false,
      reason: 'Rolled back: CRM agent operation',
      additionalInfo: 'Rolled back by the CRM agent. Do not contact or process.',
      updatedAt: new Date(),
    }).where(eq(leads.id, lead_id)).returning({
      id: leads.id,
      userId: leads.userId,
      isActive: leads.isActive,
      sendMarketingEmails: leads.sendMarketingEmails,
      reason: leads.reason,
      updatedAt: leads.updatedAt,
    });
    if (!lead) throw new Error('Lead not found.');
    return lead;
  }, { backup: true });
}
