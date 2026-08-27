import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';

import type * as schema from '../schema';

export type DrizzleDatabase = PostgresJsDatabase<typeof schema>;

/** The transaction handle {@link DrizzleDatabase}.transaction hands to its callback. */
export type DrizzleTransaction = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
