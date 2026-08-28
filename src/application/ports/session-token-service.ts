/**
 * Opaque session-token operations: generation and deterministic hashing.
 *
 * A port so the Application layer stays free of Node crypto APIs. The
 * production implementation generates 256-bit random tokens and persists
 * only their SHA-256 hashes — the raw token is never stored or logged.
 */
export interface SessionTokenService {
  /** Fresh high-entropy bearer token; returned to the client exactly once. */
  generate(): string;

  /** Deterministic digest used as the persisted session identifier. */
  hash(token: string): string;
}
