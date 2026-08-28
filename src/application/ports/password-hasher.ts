/**
 * Password hasher port.
 *
 * The application layer never sees a specific hashing algorithm; the
 * infrastructure implementation (argon2id) provides both hashing and
 * timing-safe verification.
 */
export interface PasswordHasher {
  /**
   * Hashes a plaintext password for persistent storage.
   */
  hash(plaintext: string): Promise<string>;

  /**
   * Verifies a plaintext password against a stored hash in constant time.
   */
  verify(hash: string, plaintext: string): Promise<boolean>;
}
