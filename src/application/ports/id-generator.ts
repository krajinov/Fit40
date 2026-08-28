/**
 * Generates domain identifiers (e.g. UserId) at entity-creation time.
 *
 * A port so the Application layer stays free of Node crypto APIs; the
 * production implementation uses `crypto.randomUUID()`.
 */
export interface IdGenerator {
  generate(): string;
}
