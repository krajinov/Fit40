import { describe, expect, it } from 'vitest';

import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('NodeIdGenerator', () => {
  const generator = new NodeIdGenerator();

  it('generates RFC 4122 version 4 UUIDs', () => {
    expect(generator.generate()).toMatch(UUID_V4);
  });

  it('generates a unique value on every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generator.generate()));

    expect(ids.size).toBe(100);
  });
});
