import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';

import * as schema from './schema';

const connectionString = env.DATABASE_URL;

// Create the postgres.js client with connection pooling
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create the Drizzle ORM instance
export const db = drizzle(client, { schema });

// Type of the shared Drizzle instance; repositories accept this so that tests
// can inject their own client backed by TEST_DATABASE_URL.
export type Database = typeof db;

// Export the raw client for transactions or advanced use cases
export { client };