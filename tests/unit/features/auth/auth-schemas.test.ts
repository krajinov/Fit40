import { describe, expect, it } from 'vitest';

import {
  nextPathSchema,
  registerSchema,
  resolveSafeNextPath,
} from '@/features/auth/schemas/auth-schemas';

describe('nextPathSchema / resolveSafeNextPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/programs/abc?x=1#section', '/programs/abc?x=1#section'],
    ['/', '/'],
    ['/register?next=/dashboard', '/register?next=/dashboard'],
  ])('accepts and preserves %s', (input, expected) => {
    const result = nextPathSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected rejection');
    expect(result.data).toBe(expected);
    expect(resolveSafeNextPath(input)).toBe(expected);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '\\evil.example',
    'https://evil.example',
    'http://evil.example://x',
    'https:%2F%2Fevil.example',
    'javascript:alert(1)',
    '',
    'not-a-path',
  ])('rejects %s', (input) => {
    expect(nextPathSchema.safeParse(input).success).toBe(false);
    expect(resolveSafeNextPath(input)).toBeNull();
  });

  it.each([
    '/%2Fevil.example', // decodes to //evil.example
    '/\\evil.example', // raw backslash smuggling
    '/%5Cevil.example', // decodes to \evil.example
    '/%5C%5Cevil.example', // decodes to two backslashes
    '/%2f%2fevil.example', // decodes to ///evil.example
  ])('rejects encoded or backslash variants: %s', (input) => {
    expect(nextPathSchema.safeParse(input).success).toBe(false);
  });

  it('normalizes dot-segments to a safe same-origin path', () => {
    // Percent-encoded dot segments normalize to the app root, which stays
    // same-origin and is therefore safe.
    expect(resolveSafeNextPath('/%2e%2e/%2e%2e')).toBe('/');
  });
});

describe('registerSchema validation feedback', () => {
  it.each([
    ['12345678', 'different'],
    ['', ''],
  ])('reports mismatched confirm password for %j', (_password, confirm) => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: '12345678',
      confirmPassword: confirm,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected success');

    const issues = result.error.issues;
    const confirmIssue = issues.find((issue) => issue.path[0] === 'confirmPassword');
    expect(confirmIssue).toBeDefined();
    expect(confirmIssue?.message).toContain('do not match');
  });

  it('reports a password longer than 128 characters', () => {
    const long = 'x'.repeat(129);
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: long,
      confirmPassword: long,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected success');

    const passwordIssue = result.error.issues.find((issue) => issue.path[0] === 'password');
    expect(passwordIssue).toBeDefined();
    expect(passwordIssue?.message).toContain('128');
  });
});