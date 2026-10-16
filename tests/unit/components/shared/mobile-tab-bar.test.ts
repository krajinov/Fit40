/**
 * @vitest-environment jsdom
 *
 * Navigation contracts: destinations, accessible labels, active routes and
 * authentication. Geometry and breakpoint visibility need a real browser.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const pathnameRef = vi.hoisted(() => ({ current: '/dashboard' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathnameRef.current }));

import { MobileTabBar } from '@/components/shared/MobileTabBar';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderBar(isAuthenticated: boolean): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MobileTabBar, { isAuthenticated }));
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

function tabs(container: HTMLElement) {
  return [...container.querySelectorAll('nav a')].map((link) => ({
    href: link.getAttribute('href'),
    label: link.textContent,
    active: link.getAttribute('aria-current') === 'page',
  }));
}

describe('MobileTabBar — signed out', () => {
  it('renders nothing at all: no private destinations are ever offered', async () => {
    const container = await renderBar(false);

    expect(container.querySelector('a, button, nav')).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('MobileTabBar — signed in', () => {
  it('renders exactly the four locked tabs, in order, with no Profile tab', async () => {
    const container = await renderBar(true);

    expect(tabs(container)).toEqual([
      { href: '/dashboard', label: 'Home', active: true },
      { href: '/programs', label: 'Programs', active: false },
      { href: '/exercises', label: 'Exercises', active: false },
      { href: '/progress', label: 'Progress', active: false },
    ]);
    expect(container.querySelector('a[href="/profile"]')).toBeNull();
  });

  it('names its Primary landmark and keeps decorative icons out of link names', async () => {
    const container = await renderBar(true);

    expect(container.querySelectorAll('nav[aria-label="Primary"]')).toHaveLength(1);
    for (const link of container.querySelectorAll('nav a')) {
      for (const icon of link.querySelectorAll('svg')) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
      expect(link.getAttribute('aria-hidden')).not.toBe('true');
    }
  });

  it('marks the active tab and clears it when no tab matches the route', async () => {
    pathnameRef.current = '/history';
    const historyContainer = await renderBar(true);
    expect(tabs(historyContainer).every((tab) => !tab.active)).toBe(true);

    pathnameRef.current = '/progress';
    const progressContainer = await renderBar(true);
    expect(tabs(progressContainer).find((tab) => tab.active)).toEqual({
      href: '/progress',
      label: 'Progress',
      active: true,
    });

    pathnameRef.current = '/dashboard';
    const nestedContainer = await renderBar(true);
    expect(tabs(nestedContainer)[0]).toEqual({
      href: '/dashboard',
      label: 'Home',
      active: true,
    });
  });

  it('still hides itself on the active-workout route (preserved contract)', async () => {
    pathnameRef.current = '/programs/fit40-beginner-strength/weeks/1/workouts/1/session';
    const container = await renderBar(true);

    expect(container.querySelector('a, button, nav')).toBeNull();
  });

  // Runtime composition (jsdom) per route family — the tab bar is the ONE bottom
  // bar on the nested History detail route, and no tab is active there because
  // History is deliberately not a tab.
  it('renders the four tabs on a nested History detail route, with no tab active', async () => {
    pathnameRef.current = '/history/sessions/0f3b1c1e-9f0e-4a4e-8f0e-0f3b1c1e9f0e';
    const container = await renderBar(true);

    expect(tabs(container)).toEqual([
      { href: '/dashboard', label: 'Home', active: false },
      { href: '/programs', label: 'Programs', active: false },
      { href: '/exercises', label: 'Exercises', active: false },
      { href: '/progress', label: 'Progress', active: false },
    ]);
  });
});

describe('MobileTabBar — server and client agree (no auth flicker)', () => {
  it('offers the same navigation before and after client rendering', async () => {
    for (const isAuthenticated of [false, true]) {
      const server = document.createElement('div');
      server.innerHTML = renderToStaticMarkup(createElement(MobileTabBar, { isAuthenticated }));
      const client = await renderBar(isAuthenticated);
      expect(tabs(client)).toEqual(tabs(server));
      expect(server.querySelectorAll('nav')).toHaveLength(isAuthenticated ? 1 : 0);
    }
  });
});

describe('MobileTabBar — route changes', () => {
  it('updates aria-current as navigation moves between nested destinations', async () => {
    const container = await renderBar(true);
    const instance = mounted.find((entry) => entry.container === container);
    if (instance === undefined) throw new Error('Missing mounted bar');

    for (const [route, activeHref] of [
      ['/programs/beginner', '/programs'],
      ['/exercises/goblet-squat', '/exercises'],
      ['/progress-archive', null],
    ]) {
      pathnameRef.current = route ?? '/';
      await act(async () => {
        instance.root.render(createElement(MobileTabBar, { isAuthenticated: true }));
      });
      expect(tabs(container).filter((tab) => tab.active).map((tab) => tab.href))
        .toEqual(activeHref === null ? [] : [activeHref]);
    }
  });
});
