import { bigint, boolean, pgSchema, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

const agentShare = pgSchema('agent_share');

export const crmUsers = agentShare.table('crm_users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  isActive: boolean('is_active'),
});

export const leads = pgTable('leads', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 255 }).notNull(),
  userId: bigint('user_id', { mode: 'number' }),
  companyId: bigint('company_id', { mode: 'number' }),
  campaign: varchar('campaign', { length: 255 }),
  interest: varchar('interest', { length: 255 }),
  additionalInfo: text('additional_info'),
  reason: varchar('reason', { length: 255 }),
  isActive: boolean('is_active').notNull(),
  sendMarketingEmails: boolean('send_marketing_emails').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
});
