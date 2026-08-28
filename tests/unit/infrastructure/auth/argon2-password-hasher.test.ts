import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from '@/infrastructure/auth/argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('verifies a correct password against its hash', async () => {
    const storedHash = await hasher.hash('correct-password');

    expect(await hasher.verify(storedHash, 'correct-password')).toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const storedHash = await hasher.hash('correct-password');

    expect(await hasher.verify(storedHash, 'wrong-password')).toBe(false);
  });

  it('propagates malformed stored hashes as unexpected errors', async () => {
    await expect(hasher.verify('not-a-valid-argon2-hash', 'password')).rejects.toThrow();
  });

  it('propagates corrupt PHC strings as unexpected errors', async () => {
    await expect(
      hasher.verify('$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$', 'password'),
    ).rejects.toThrow();
  });
});
