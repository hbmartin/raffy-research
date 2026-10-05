import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { MachineCapability } from '../../domain/machine-credential';

export const machineCredential = pgTable('machineCredential', {
  id: text('id').primaryKey(),
  secretHash: text('secretHash').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  capabilities: jsonb('capabilities').$type<MachineCapability[]>().notNull(),
  userId: text('userId'),
  state: text('state')
    .$type<'pending' | 'approved' | 'denied' | 'revoked'>()
    .notNull()
    .default('pending'),
  pairingExpiresAt: timestamp('pairingExpiresAt', {
    withTimezone: true,
    mode: 'date',
    precision: 3,
  }).notNull(),
  expiresAt: timestamp('expiresAt', {
    withTimezone: true,
    mode: 'date',
    precision: 3,
  }).notNull(),
  createdAt: timestamp('createdAt', {
    withTimezone: true,
    mode: 'date',
    precision: 3,
  })
    .notNull()
    .defaultNow(),
});
