import { pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { trainingPrograms } from './programs';
import { users } from './users';

/**
 * Program enrollment table: one row per (user, program) pair.
 *
 * The surrogate `id` (not the (user_id, program_id) pair) is the identity
 * that workout sessions reference: leaving the program deletes the row and
 * the database detaches its sessions (enrollment_id becomes null), so
 * rejoining creates a fresh enrollment whose progress starts at zero instead
 * of inheriting the previous enrollment's completed sessions.
 *
 * Foreign key policy:
 * - user deletion cascades: an account's enrollments die with the account.
 * - program deletion is restricted: programs are seeded reference data and
 *   must not silently destroy enrollments and the attached session history.
 *
 * The (user_id, program_id) unique constraint is the final authority against
 * duplicate enrollments, including concurrent joins. It doubles as the index
 * for both access patterns (lookup by pair, and listing a user's
 * enrollments), so no additional indexes are defined.
 */
export const programEnrollments = pgTable(
  'program_enrollments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => trainingPrograms.id, { onDelete: 'restrict' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    userProgramUnique: unique('program_enrollments_user_program_unique').on(
      table.userId,
      table.programId,
    ),
  }),
);
