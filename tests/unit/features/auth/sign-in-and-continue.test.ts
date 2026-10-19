/**
 * @vitest-environment jsdom
 *
 * Follow the real workout CTA through the login page's rendered hidden field
 * into the successful action. Only identity, use cases and Next request APIs
 * are mocked; redirect targets are asserted at the actual redirect call.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieStore, getCurrentUserMock, redirectMock } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  getCurrentUserMock: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/features/auth/services', () => ({ loginUserUseCase: { execute: vi.fn() } }));
vi.mock('@/features/schedule/actions/undo-not-performed', () => ({
  undoNotPerformedAction: vi.fn(),
}));

import LoginPage from '@/app/(auth)/login/page';
import { loginAction } from '@/features/auth/actions/login';
import { loginUserUseCase } from '@/features/auth/services';
import { WorkoutStartPanel } from '@/features/sessions/components/WorkoutStartPanel';

const SESSION_PATH = '/programs/fit40-beginner-strength/weeks/2/workouts/3/session';
const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');
const UNSAFE_NEXT = [
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/%2Fevil.example',
  '/%5Cevil.example',
  'javascript:alert(1)',
  '',
];

beforeEach(() => {
  vi.resetAllMocks();
  getCurrentUserMock.mockResolvedValue(null);
  vi.mocked(loginUserUseCase.execute).mockResolvedValue({
    ok: true,
    data: { user: USER, session: { token: 'test-session-token', expiresAt: EXPIRES_AT } },
  });
});

async function loginFormData(next: string | string[] | undefined): Promise<FormData> {
  const page = await LoginPage({ searchParams: Promise.resolve({ next }) });
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(page);
  const form = container.querySelector('form');
  if (form === null) throw new Error('Login page did not render a form');
  const data = new FormData(form);
  data.set('email', USER.email);
  data.set('password', 'password123');
  return data;
}

async function expectLoginRedirect(data: FormData, target: string): Promise<void> {
  await expect(loginAction(data)).rejects.toThrow(`NEXT_REDIRECT:${target}`);
  expect(redirectMock).toHaveBeenCalledExactlyOnceWith(target);
  expect(cookieStore.set).toHaveBeenCalledWith(
    'fit40_session',
    'test-session-token',
    expect.objectContaining({ httpOnly: true, expires: EXPIRES_AT }),
  );
}

describe('workout sign-in-and-continue', () => {
  it('preserves the CTA destination through the login form and final action redirect', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(createElement(WorkoutStartPanel, {
      programSlug: 'fit40-beginner-strength', weekNumber: 2, workoutOrder: 3,
      ctaState: 'anonymous',
    }));
    const cta = container.querySelector('a[href^="/login?next="]');
    const href = cta?.getAttribute('href');
    if (!href) throw new Error('Anonymous workout CTA did not link to login');
    const destination = new URL(href, 'https://fit40.local');
    expect(destination.pathname).toBe('/login');
    expect(cta?.textContent).toBe('Sign in to start');

    const data = await loginFormData(destination.searchParams.get('next') ?? undefined);
    expect(data.get('next')).toBe(SESSION_PATH);
    await expectLoginRedirect(data, SESSION_PATH);
    expect(loginUserUseCase.execute).toHaveBeenCalledExactlyOnceWith({
      email: USER.email, password: 'password123',
    });
  });

  it.each(UNSAFE_NEXT)('uses the safe fallback through the login page for %j', async (next) => {
    const data = await loginFormData(next);
    expect(data.get('next')).toBe('/dashboard');
    await expectLoginRedirect(data, '/dashboard');
  });

  it.each(UNSAFE_NEXT)('rejects a directly submitted unsafe next value %j', async (next) => {
    const data = await loginFormData(SESSION_PATH);
    // Bypass page sanitization, as a caller can tamper with hidden form input.
    data.set('next', next);
    await expectLoginRedirect(data, '/dashboard');
  });

  it.each([undefined, [SESSION_PATH, '//evil.example']])(
    'uses the safe fallback for missing or repeated query parameters: %j',
    async (next) => {
      const data = await loginFormData(next);
      expect(data.get('next')).toBe('/dashboard');
      await expectLoginRedirect(data, '/dashboard');
    },
  );

  it.each([SESSION_PATH, ...UNSAFE_NEXT])(
    'validates the immediate login-page redirect for an authenticated visitor: %j',
    async (next) => {
      getCurrentUserMock.mockResolvedValue(USER);
      const target = next === SESSION_PATH ? SESSION_PATH : '/dashboard';
      await expect(LoginPage({ searchParams: Promise.resolve({ next }) }))
        .rejects.toThrow(`NEXT_REDIRECT:${target}`);
      expect(redirectMock).toHaveBeenCalledExactlyOnceWith(target);
      expect(loginUserUseCase.execute).not.toHaveBeenCalled();
      expect(cookieStore.set).not.toHaveBeenCalled();
    },
  );
});
