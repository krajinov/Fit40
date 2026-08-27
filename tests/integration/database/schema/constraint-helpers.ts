/**
 * Helpers for asserting on database-level rejections.
 *
 * Drizzle wraps driver errors in a "Failed query" error and keeps the original
 * PostgresError in `cause`, so constraint names only appear once the whole chain
 * is flattened into a single message.
 */

/** Collects the messages of an error and every error it was caused by. */
export function describeFailure(error: unknown): string {
  const messages: string[] = [];

  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages.join('\n');
}

/**
 * Runs a write that the schema must reject and returns the failure message.
 * Throws when the write unexpectedly succeeded.
 */
export async function failureMessage(write: () => Promise<unknown>): Promise<string> {
  try {
    await write();
  } catch (error) {
    return describeFailure(error);
  }

  throw new Error('Expected the database to reject this write');
}
