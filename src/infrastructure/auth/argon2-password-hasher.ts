/**
 * argon2id implementation of the PasswordHasher port.
 *
 * Uses @node-rs/argon2 with the OWASP-recommended argon2id parameters
 * (the library defaults: m=19456, t=2, p=1). Verification is timing-safe
 * inside the library. Plaintext passwords are never stored or logged.
 */

import { hash, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '@/application/ports/password-hasher';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext);
  }

  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext);
    } catch {
      // A malformed stored hash is a verification failure, not a crash.
      return false;
    }
  }
}
