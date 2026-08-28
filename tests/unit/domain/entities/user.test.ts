import { describe, expect, it } from 'vitest';

import { createUser } from '@/domain/entities/user';

describe('createUser', () => {
  it('creates a user with a valid id and email', () => {
    const result = createUser({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(result.data.email).toBe('user@example.com');
      expect(result.data.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    }
  });

  it('rejects an empty id', () => {
    const result = createUser({ id: '   ', email: 'user@example.com', createdAt: new Date() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('id');
    }
  });

  it('rejects an invalid email', () => {
    const result = createUser({ id: 'id-1', email: 'invalid', createdAt: new Date() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('email');
    }
  });

  it('rejects an invalid createdAt date', () => {
    const result = createUser({ id: 'id-1', email: 'user@example.com', createdAt: new Date(NaN) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('createdAt');
    }
  });
});
