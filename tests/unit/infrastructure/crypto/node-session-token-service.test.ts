import { describe, expect, it } from 'vitest';

import { NodeSessionTokenService } from '@/infrastructure/crypto/node-session-token-service';

// SHA-256("fit40") — known-answer test for the persisted token digest.
const SHA256_OF_FIT40 = '1d4178f816fcffe98de0d4220b6017ed6fa93d6417d21dc97a5eb1613f597a81';

describe('NodeSessionTokenService', () => {
  const service = new NodeSessionTokenService();

  it('hashes tokens to the exact SHA-256 hex digest (known answer)', () => {
    expect(service.hash('fit40')).toBe(SHA256_OF_FIT40);
  });

  it('hashes deterministically and differs per input', () => {
    expect(service.hash('token-a')).toBe(service.hash('token-a'));
    expect(service.hash('token-a')).not.toBe(service.hash('token-b'));
  });

  it('generates 256-bit base64url tokens (43 chars, URL-safe alphabet)', () => {
    const token = service.generate();

    // 32 random bytes encode to exactly 43 unpadded base64url characters.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a unique token on every call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => service.generate()));

    expect(tokens.size).toBe(100);
  });
});
