import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Authentication identity tables.
 *
 * `users` is the minimal authentication identity — fitness profile data
 * belongs to future Profile/Onboarding slices and must not be added here.
 * The email column enforces canonical (lowercase) storage at the database
 * level as the final authority, matching the domain's EmailAddress
 * normalization.
 *
 * `auth_sessions` stores database-backed login sessions keyed by the SHA-256
 * hash of the opaque bearer token, so a database leak never exposes usable
 * session tokens.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailNonEmptyCheck: check('users_email_non_empty_check', sql`${table.email} <> ''`),
    emailLowercaseCheck: check('users_email_lowercase_check', sql`${table.email} = lower(${table.email})`),
  }),
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('auth_sessions_user_id_idx').on(table.userId),
    expiryCheck: check(
      'auth_sessions_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);
