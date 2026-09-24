/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the application-shell headers' `account` slot: the
 * shared headers must render exactly what the route-group layout hands them
 * and fall back to the ordinary sign-in link otherwise — no feature import,
 * no session semantics inside the shared shell.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// AppNavLinks is a client component reading the active route; the shell test
// only needs it to render, so the router hook is stubbed.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

import { AppHeader } from '@/components/shared/AppHeader';
import { MobileHeader } from '@/components/shared/MobileHeader';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderHeader(
  Header: typeof AppHeader | typeof MobileHeader,
  account: Parameters<typeof AppHeader>[0]['account'],
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Header, { account }));
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
});

describe.each([
  ['AppHeader', AppHeader],
  ['MobileHeader', MobileHeader],
] as const)('%s account slot', (_name, Header) => {
  it('renders the composed account control unchanged', async () => {
    const container = await renderHeader(Header, createElement('span', null, 'Account control'));

    expect(container.textContent).toContain('Account control');
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });

  it('falls back to the sign-in link for signed-out visitors', async () => {
    const container = await renderHeader(Header, null);

    const signIn = container.querySelector('a[href="/login"]');
    expect(signIn?.textContent).toBe('Sign in');
    expect(container.textContent).not.toContain('Account control');
  });
});