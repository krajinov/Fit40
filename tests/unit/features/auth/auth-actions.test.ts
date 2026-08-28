import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthActionState } from '@/features/auth/types/auth-action-state';

const { mockCookieStore, redirectMock } = vi.hoisted(() => {
  type CookieStore = {
    get(name: string): { value: string } | undefined;
    set(name: string, value: string, options: unknown): void;
    delete(name: string): void;
  };

  const cookies: Record<string, { value: string; options?: unknown }> = {};

  const store: CookieStore = {
    get: (name) => cookies[name],
    set: (name, value, options) => {
      cookies[name] = { value, options };
    },
    delete: (name) => {
      delete cookies[name];
    },
  };

  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });

  return { mockCookieStore: store, redirectMock: redirect };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('@/features/auth/services', () => ({
  registerUserUseCase: { execute: vi.fn() },
  loginUserUseCase: { execute: vi.fn() },
  logoutUserUseCase: { execute: vi.fn() },
  getCurrentUserUseCase: { execute: vi.fn() },
}));

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { loginAction } from '@/features/auth/actions/login';
import { logoutAction } from '@/features/auth/actions/logout';
import { registerAction } from '@/features/auth/actions/register';
import {
  loginUserUseCase,
  logoutUserUseCase,
  registerUserUseCase,
} from '@/features/auth/services';

function makeRegisterFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('email', 'user@example.com');
  fd.set('password', 'password123');
  fd.set('confirmPassword', 'password123');
  fd.set('next', '/dashboard');
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

function makeLoginFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('email', 'user@example.com');
  fd.set('password', 'password123');
  fd.set('next', '/dashboard');
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

describe('auth actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCookieStore.delete('fit40_session');
  });

  describe('registerAction', () => {
    it('returns validation errors for invalid input', async () => {
      const fd = makeRegisterFormData({ email: 'not-an-email', password: 'short' });
      const result = (await registerAction(fd)) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(registerUserUseCase.execute).not.toHaveBeenCalled();
    });

    it('returns EMAIL_ALREADY_EXISTS from the use case', async () => {
      vi.mocked(registerUserUseCase.execute).mockResolvedValue({
        ok: false,
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          email: 'user@example.com',
          message: 'An account with this email already exists.',
        },
      });

      const result = (await registerAction(makeRegisterFormData())) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(result.error.fieldErrors?.email).toContain(
        'An account with this email already exists.',
      );
    });

    it('sets the session cookie and redirects on success', async () => {
      vi.mocked(registerUserUseCase.execute).mockResolvedValue({
        ok: true,
        data: {
          user: { id: 'u-1', email: 'user@example.com', createdAt: new Date().toISOString() },
          session: { token: 'session-token', expiresAt: new Date('2099-01-01T00:00:00Z') },
        },
      });

      await expect(registerAction(makeRegisterFormData())).rejects.toThrow('NEXT_REDIRECT:/dashboard');

      const store = await cookies();
      expect(store.get('fit40_session')?.value).toBe('session-token');
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    });

    it('rejects an external redirect target', async () => {
      vi.mocked(registerUserUseCase.execute).mockResolvedValue({
        ok: true,
        data: {
          user: { id: 'u-1', email: 'user@example.com', createdAt: new Date().toISOString() },
          session: { token: 'session-token', expiresAt: new Date('2099-01-01T00:00:00Z') },
        },
      });

      const fd = makeRegisterFormData({ next: 'https://attacker.example' });

      await expect(registerAction(fd)).rejects.toThrow('NEXT_REDIRECT:/dashboard');
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    });

    it('preserves the submitted email in state on VALIDATION_ERROR', async () => {
      const fd = makeRegisterFormData({ email: 'User@Example.com', password: 'short' });
      const result = (await registerAction(fd)) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.email).toBe('User@Example.com');
    });

    it('preserves the submitted email in state on EMAIL_ALREADY_EXISTS', async () => {
      vi.mocked(registerUserUseCase.execute).mockResolvedValue({
        ok: false,
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          email: 'user@example.com',
          message: 'An account with this email already exists.',
        },
      });

      const result = (await registerAction(makeRegisterFormData())) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.error.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(result.email).toBe('user@example.com');
      expect(JSON.stringify(result)).not.toContain('password123');
    });

    it('never returns password values in action state', async () => {
      const fd = makeRegisterFormData({
        email: 'not-an-email',
        password: 'secret-value-123',
        confirmPassword: 'different-secret-456',
      });
      const result = (await registerAction(fd)) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      // Field-error KEYS (e.g. confirmPassword as a fieldErrors entry) are
      // intentional UX; credential VALUES must never appear in state.
      expect(JSON.stringify(result)).not.toContain('secret-value-123');
      expect(Object.keys(result.error.fieldErrors ?? {})).toContain('confirmPassword');
      expect(result.email).toBe('not-an-email');
    });
  });

  describe('loginAction', () => {
    it('returns validation errors for missing password', async () => {
      const fd = makeLoginFormData({ password: '' });
      const result = (await loginAction(fd)) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns INVALID_CREDENTIALS from the use case', async () => {
      vi.mocked(loginUserUseCase.execute).mockResolvedValue({
        ok: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      });

      const result = (await loginAction(makeLoginFormData())) as AuthActionState;

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unexpected success');

      expect(result.error.code).toBe('INVALID_CREDENTIALS');
      expect(result.email).toBe('user@example.com');
      expect(JSON.stringify(result)).not.toContain('password123');
    });

    it('sets the session cookie and redirects on success', async () => {
      vi.mocked(loginUserUseCase.execute).mockResolvedValue({
        ok: true,
        data: {
          user: { id: 'u-1', email: 'user@example.com', createdAt: new Date().toISOString() },
          session: { token: 'session-token', expiresAt: new Date('2099-01-01T00:00:00Z') },
        },
      });

      await expect(loginAction(makeLoginFormData())).rejects.toThrow('NEXT_REDIRECT:/dashboard');

      const store = await cookies();
      expect(store.get('fit40_session')?.value).toBe('session-token');
    });
  });

  describe('logoutAction', () => {
    it('deletes the session and clears the cookie', async () => {
      mockCookieStore.set('fit40_session', 'old-token', {});
      vi.mocked(logoutUserUseCase.execute).mockResolvedValue({ ok: true, data: null });

      await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/');

      expect(logoutUserUseCase.execute).toHaveBeenCalledWith({ token: 'old-token' });
      expect(mockCookieStore.get('fit40_session')).toBeUndefined();
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('is idempotent when no session cookie exists', async () => {
      await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/');

      expect(logoutUserUseCase.execute).not.toHaveBeenCalled();
      expect(mockCookieStore.get('fit40_session')).toBeUndefined();
      expect(redirect).toHaveBeenCalledWith('/');
    });

    it('still clears the cookie when server-side revocation fails', async () => {
      mockCookieStore.set('fit40_session', 'old-token', {});
      vi.mocked(logoutUserUseCase.execute).mockRejectedValue(new Error('db unreachable'));

      await expect(logoutAction()).rejects.toThrow('db unreachable');

      expect(mockCookieStore.get('fit40_session')).toBeUndefined();
      expect(redirect).not.toHaveBeenCalled();
    });
  });
});
