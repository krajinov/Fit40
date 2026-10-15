/**
 * @vitest-environment jsdom
 *
 * M19 S3 presentation tests for the application shell's authentication-aware
 * navigation. The shared headers render exactly the account slot the layout
 * hands them and exactly the destinations the server-resolved auth state
 * allows:
 * - signed out: the public catalog (Programs, Exercises) plus a Sign in link;
 *   private destinations are never rendered;
 * - signed in: the locked five desktop destinations, in order.
 * The shell still imports no feature and owns no session state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The active route is client state owned by next/navigation; the shell test
// only needs it to render, so the hook reads a per-test mutable value.
const pathnameRef = vi.hoisted(() => ({ current: '/dashboard' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { AppHeader } from '@/components/shared/AppHeader';
import { MobileHeader } from '@/components/shared/MobileHeader';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

interface HeaderProps {
  readonly account: ReactNode | null;
  readonly isAuthenticated: boolean;
}

async function renderHeader(
  Header: typeof AppHeader | typeof MobileHeader,
  props: HeaderProps,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Header, props));
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  pathnameRef.current = '/dashboard';
});

/** Every primary-navigation destination the container actually renders. */
function navLinks(container: HTMLElement) {
  return [...container.querySelectorAll('nav[aria-label="Primary"] a')].map((link) => ({
    href: link.getAttribute('href'),
    label: link.textContent,
    active: link.getAttribute('aria-current') === 'page',
  }));
}

describe.each([
  ['AppHeader', AppHeader],
  ['MobileHeader', MobileHeader],
] as const)('%s account slot', (_name, Header) => {
  it('renders the composed account control unchanged', async () => {
    const container = await renderHeader(Header, {
      account: createElement('span', null, 'Account control'),
      isAuthenticated: true,
    });

    expect(container.textContent).toContain('Account control');
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });

  it('falls back to the sign-in link for signed-out visitors', async () => {
    const container = await renderHeader(Header, { account: null, isAuthenticated: false });

    const signIn = container.querySelector('a[href="/login"]');
    expect(signIn?.textContent).toBe('Sign in');
    expect(container.textContent).not.toContain('Account control');
  });
});

describe('desktop navigation (AppHeader)', () => {
  it('shows only the public destinations plus Sign in when signed out', async () => {
    const container = await renderHeader(AppHeader, { account: null, isAuthenticated: false });

    expect(navLinks(container)).toEqual([
      { href: '/programs', label: 'Programs', active: false },
      { href: '/exercises', label: 'Exercises', active: false },
    ]);
    expect(container.textContent).not.toContain('Dashboard');
    expect(container.textContent).not.toContain('History');
    expect(container.textContent).not.toContain('Progress');
    expect(container.querySelector('a[href="/login"]')?.textContent).toBe('Sign in');
  });

  it('shows the locked five destinations in order when signed in', async () => {
    const container = await renderHeader(AppHeader, {
      account: createElement('span', null, 'Account control'),
      isAuthenticated: true,
    });

    expect(navLinks(container).map((link) => link.label)).toEqual([
      'Dashboard',
      'Programs',
      'Exercises',
      'History',
      'Progress',
    ]);
    expect(navLinks(container).map((link) => link.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/history',
      '/progress',
    ]);
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });

  it('marks the active destination, including nested routes', async () => {
    pathnameRef.current = '/programs/fit40-beginner-strength';
    const container = await renderHeader(AppHeader, { account: null, isAuthenticated: false });

    expect(navLinks(container)).toEqual([
      { href: '/programs', label: 'Programs', active: true },
      { href: '/exercises', label: 'Exercises', active: false },
    ]);
  });

  it('never activates a destination on a merely similar path', async () => {
    pathnameRef.current = '/progress-archive';
    const container = await renderHeader(AppHeader, {
      account: createElement('span', null, 'Account control'),
      isAuthenticated: true,
    });

    expect(navLinks(container).every((link) => !link.active)).toBe(true);
  });
});

describe('mobile header navigation (MobileHeader)', () => {
  it('keeps the public catalog reachable and offers Sign in when signed out', async () => {
    const container = await renderHeader(MobileHeader, { account: null, isAuthenticated: false });

    expect(navLinks(container)).toEqual([
      { href: '/programs', label: 'Programs', active: false },
      { href: '/exercises', label: 'Exercises', active: false },
    ]);
    expect(container.querySelector('a[href="/login"]')?.textContent).toBe('Sign in');
  });

  it('marks the active public destination', async () => {
    pathnameRef.current = '/exercises/goblet-squat';
    const container = await renderHeader(MobileHeader, { account: null, isAuthenticated: false });

    expect(navLinks(container)).toEqual([
      { href: '/programs', label: 'Programs', active: false },
      { href: '/exercises', label: 'Exercises', active: true },
    ]);
  });

  it('renders no header navigation for signed-in visitors (the tab bar owns it)', async () => {
    const container = await renderHeader(MobileHeader, {
      account: createElement('span', null, 'Account control'),
      isAuthenticated: true,
    });

    expect(navLinks(container)).toEqual([]);
    expect(container.textContent).not.toContain('Programs');
    expect(container.textContent).not.toContain('Exercises');
    expect(container.textContent).toContain('Account control');
  });

describe.each([
  ['AppHeader', AppHeader],
  ['MobileHeader', MobileHeader],
] as const)('%s wordmark destination (S3 review P2)', (_name, Header) => {
  it('sends signed-out visitors to the public home route, never /dashboard', async () => {
    const container = await renderHeader(Header, { account: null, isAuthenticated: false });

    const wordmark = container.querySelector('a[aria-label="Fit40 home"]');
    expect(wordmark?.getAttribute('href')).toBe('/');
  });

  it('keeps signed-in visitors on the existing /dashboard destination', async () => {
    const container = await renderHeader(Header, {
      account: createElement('span', null, 'Account control'),
      isAuthenticated: true,
    });

    const wordmark = container.querySelector('a[aria-label="Fit40 home"]');
    expect(wordmark?.getAttribute('href')).toBe('/dashboard');
  });
});
});