/**
 * @vitest-environment jsdom
 *
 * M19 S3: the authenticated four-tab bar (Home / Programs / Exercises /
 * Progress) and its complete absence for signed-out visitors. The bar's
 * signed-in rendering keeps every locked property (76px bar, safe-area
 * padding, four slots, 22px icons, `aria-label="Primary"`, `aria-current`) and
 * its `/session` hide, unchanged by S3.
 *
 * The last test compares the SERVER markup (`renderToStaticMarkup`) with the
 * client markup for the same props: the auth decision comes from the
 * server-resolved prop, so both renders agree — no hydration switch and no
 * private flash.
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

    expect(container.innerHTML).toBe('');
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

  it('keeps the locked bar structure, geometry and icon treatment', async () => {
    const container = await renderBar(true);

    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Primary');
    expect(nav?.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(nav?.className).toContain('md:hidden');
    expect(container.querySelector('.h-\\[76px\\]')).not.toBeNull();

    const icons = [...container.querySelectorAll('svg')];
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.getAttribute('class')).toContain('size-[22px]');
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

    expect(container.innerHTML).toBe('');
  });
});

describe('MobileTabBar — server and client agree (no auth flicker)', () => {
  it('produces identical markup for the same props in both renderers', async () => {
    for (const isAuthenticated of [false, true]) {
      const server = renderToStaticMarkup(createElement(MobileTabBar, { isAuthenticated }));
      const client = (await renderBar(isAuthenticated)).innerHTML;
      expect(client).toBe(server);
    }
  });
});
describe('MobileTabBar — M19 S4 geometry, clearance and overflow guards', () => {
  it('keeps the 76px slot with fixed-pixel padding so font scaling cannot shrink it', async () => {
    const container = await renderBar(true);

    const row = container.querySelector('nav > div');
    expect(row?.className).toContain('h-[76px]');
    expect(row?.className).toContain('items-stretch');
    expect(row?.className).toContain('pt-[8px] pb-[16px]');
    // Rem-scaled vertical padding is what used to squeeze the 52px targets down
    // to 40px at 150% text and 28px at 200%.
    expect(row?.className).not.toMatch(/\bpt-2\b/);
    expect(row?.className).not.toMatch(/\bpb-4\b/);
    expect(row?.querySelectorAll('a')).toHaveLength(4);
  });

  it('lets every slot shrink and truncate instead of scrolling the page sideways', async () => {
    const container = await renderBar(true);

    const links = [...container.querySelectorAll('nav > div > a')];
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.className).toContain('min-w-0');
      expect(link.className).toContain('flex-1');
      const label = link.querySelector('span');
      expect(label?.className).toContain('truncate');
      expect(label?.className).toContain('max-w-full');
      // Truncation is visual only: the full label stays in the DOM, so the
      // accessible name never degrades.
      expect(label?.textContent).toBe(link.textContent);
    }
  });

  it('keeps the safe-area padding and the 1px top border on the bar surface', async () => {
    const container = await renderBar(true);

    const nav = container.querySelector('nav');
    expect(nav?.className).toContain('border-t');
    expect(nav?.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(nav?.className).toContain('bottom-0');
  });
});
