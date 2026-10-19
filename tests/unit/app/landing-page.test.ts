/**
 * M19 S6 — landing page authentication states.
 *
 * The landing page is the public entry point outside the (app) shell. This has
 * to keep working for both auth states while the leftover `LogoutButton` is
 * gone: sign-out is owned only by the account menu in the application shell.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { getCurrentUserMock } = vi.hoisted(() => ({ getCurrentUserMock: vi.fn() }));

vi.mock('@/features/auth/current-user', () => ({
  getCurrentUser: getCurrentUserMock,
}));

import HomePage from '@/app/page';

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
});

describe('landing page — signed out', () => {
  it('offers account creation and sign-in, and never a private destination', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await HomePage());

    expect(hrefs(html)).toEqual(['/register', '/login']);
    expect(html).toContain('Create account');
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Dashboard');
  });
});

describe('landing page — signed in', () => {
  it('keeps the Dashboard CTA and renders no sign-out control', async () => {
    getCurrentUserMock.mockResolvedValue(USER);

    const html = renderToStaticMarkup(await HomePage());

    expect(hrefs(html)).toEqual(['/dashboard']);
    expect(html).toContain('Dashboard');
    // The leftover landing sign-out control is removed; the account menu is the
    // single sign-out surface.
    expect(html).not.toContain('Sign out');
    expect(html).not.toContain('Sign in');
    expect(html).not.toContain('Create account');
    expect(html).not.toMatch(/<form/i);
  });
});
