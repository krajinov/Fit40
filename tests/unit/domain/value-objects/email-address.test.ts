import { describe, expect, it } from 'vitest';

import {
  createEmailAddress,
  normalizeEmail,
} from '@/domain/value-objects/email-address';

describe('normalizeEmail', () => {
  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('lowercases characters', () => {
    expect(normalizeEmail('User@Example.com')).toBe('user@example.com');
  });
});

describe('createEmailAddress', () => {
  it('accepts a valid normalized email', () => {
    const result = createEmailAddress('user@example.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('user@example.com');
    }
  });

  it('normalizes during construction', () => {
    const result = createEmailAddress('  User@Example.com  ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('user@example.com');
    }
  });

  it('rejects an empty email', () => {
    const result = createEmailAddress('   ');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('cannot be empty');
    }
  });

  it('rejects a missing @', () => {
    const result = createEmailAddress('notanemail');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not valid');
    }
  });

  it('rejects a missing domain dot', () => {
    const result = createEmailAddress('user@example');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('not valid');
    }
  });
});
