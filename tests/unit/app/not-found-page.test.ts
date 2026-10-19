/**
 * M19 S6 — context-aware 404.
 *
 * The not-found page is a dead end outside the application shell. It keeps a
 * public destination for every visitor and one contextual destination chosen
 * from the session cookie's presence. It must never redirect (that would
 * destroy the native 404), never call requireUser() and never read the
 * database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { getSessionTokenMock } = vi.hoisted(() => ({ getSessionTokenMock: vi.fn() }));

vi.mock('@/features/auth/session-cookie', () => ({
  getSessionToken: getSessionTokenMock,
}));

import NotFoundPage from '@/app/not-found';

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

beforeEach(() => {
  getSessionTokenMock.mockReset();
});

describe('404 — shared surface', () => {
  it('renders one main landmark, the 404 heading and the public catalog link', async () => {
    getSessionTokenMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await NotFoundPage());

    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    expect(html).toContain('404');
    expect(html).toContain('We could not find the page you were looking for.');
    expect(hrefs(html)).toContain('/exercises');
    expect(html).toContain('Browse the exercise catalog');
  });

  it('names its navigation and gives every link a 44px target and a focus ring', async () => {
    getSessionTokenMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await NotFoundPage());

    expect(html).toContain('aria-label="Suggested destinations"');
    for (const href of hrefs(html)) {
      expect(href.startsWith('/')).toBe(true);
      expect(href.startsWith('//')).toBe(false);
    }
    expect(html.match(/min-h-11/g)?.length).toBe(hrefs(html).length);
    expect(html.match(/focus-visible:ring-3/g)?.length).toBe(hrefs(html).length);
  });
});

describe('404 — signed out', () => {
  it('offers sign-in and no private destination', async () => {
    getSessionTokenMock.mockResolvedValue(null);

    const html = renderToStaticMarkup(await NotFoundPage());

    expect(hrefs(html)).toEqual(['/exercises', '/login']);
    expect(html).toContain('Sign in');
    for (const privateHref of ['/dashboard', '/history', '/progress', '/profile']) {
      expect(hrefs(html)).not.toContain(privateHref);
    }
    expect(html).not.toContain('Go to your dashboard');
  });
});

describe('404 — signed in', () => {
  it('offers the dashboard and no sign-in link', async () => {
    getSessionTokenMock.mockResolvedValue('session-token');

    const html = renderToStaticMarkup(await NotFoundPage());

    expect(hrefs(html)).toEqual(['/exercises', '/dashboard']);
    expect(html).toContain('Go to your dashboard');
    expect(hrefs(html)).not.toContain('/login');
  });
});
