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
    // The library returns `false` ONLY for a well-formed stored hash whose
    // password does not match (a legitimate bad-credential outcome).
    //
    // Malformed/corrupt stored hashes and native/runtime/operational verifier
    // failures throw. Those are unexpected infrastructure errors and MUST
    // propagate — converting them to `false` would disguise broken persisted
    // state or outages as INVALID_CREDENTIALS. Failures are preserved with
    // their original error for observability.
    return verify(storedHash, plaintext);
  }
}
