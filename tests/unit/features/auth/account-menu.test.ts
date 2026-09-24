/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the global account menu (post-M12 UX slice): the
 * trigger keeps the locked-design pill per breakpoint and the panel exposes
 * profile navigation plus the app-wide sign-out. Sign-out is asserted as a
 * native form POST wired to the existing Server Action — no client-side
 * session state and no second mutation path.
 *
 * The panel is rendered with `defaultOpen` because jsdom never mounts the
 * positioner on interaction; the closed state is asserted separately.
 *
 * The closing blocks cover the states around the client takeover:
 * `renderToStaticMarkup` runs no effects and no bundle (the pre-hydration /
 * bundle-never-loaded markup), and hydrating that exact markup with
 * `hydrateRoot` asserts the swap from the native fallback to the interactive
 * menu. Mounted tests use react-dom (React 19 act), the same pattern as the
 * other presentation tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

// The action module pulls in the auth composition root (DB wiring); this test
// only proves the wiring shape, so the action itself is stubbed — as the marker
// string a no-JS browser would post to, matching the markup React emits for a
// real `'use server'` action reference.
vi.mock('@/features/auth/actions/logout', () => ({ logoutAction: '/__logout-action' }));

import { AccountMenu } from '@/features/auth/components/AccountMenu';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderMenu(props: Parameters<typeof AccountMenu>[0]): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AccountMenu, props));
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

describe('AccountMenu', () => {
  it('renders the desktop pill trigger with the account initial', async () => {
    const container = await renderMenu({ userEmail: 'marta@example.com', variant: 'desktop' });

    const trigger = container.querySelector('button');
    expect(trigger?.textContent).toContain('M');
    expect(trigger?.textContent).toContain('Profile');
  });

  it('labels the mobile avatar trigger for assistive tech', async () => {
    const container = await renderMenu({ userEmail: 'marta@example.com', variant: 'mobile' });

    const trigger = container.querySelector('button');
    expect(trigger?.getAttribute('aria-label')).toBe('Account');
    expect(trigger?.textContent).toBe('M');
  });

  it('gives the mobile control a 44px hit area around the 32px avatar', async () => {
    // `size-11` = 44px and `size-8` = 32px on Tailwind's spacing scale: the
    // interactive box meets the docs/ui.md floor while the drawn avatar keeps
    // its own size, so the visible control is unchanged.
    const trigger = (await renderMenu({ userEmail: 'marta@example.com', variant: 'mobile' }))
      .querySelector('button');
    expect(trigger?.className).toContain('size-11');
    // The visuals live on the inner circle, never on the hit area.
    expect(trigger?.className).not.toContain('bg-accent-tint');
    expect(trigger?.querySelector('span[aria-hidden="true"]')?.className).toContain('size-8');
    expect(trigger?.querySelector('span[aria-hidden="true"]')?.className).toContain(
      'bg-accent-tint',
    );
  });

  it('keeps the panel closed by default', async () => {
    const container = await renderMenu({ userEmail: 'marta@example.com', variant: 'desktop' });

    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Sign out');
  });

  it('opens a panel with profile navigation to the profile screen', async () => {
    await renderMenu({
      userEmail: 'marta@example.com',
      variant: 'desktop',
      defaultOpen: true,
    });

    const link = document.querySelector('a[href="/profile"]');
    expect(link?.textContent).toBe('Profile');
  });

  it('signs out through a native form POST to the existing Server Action', async () => {
    await renderMenu({
      userEmail: 'marta@example.com',
      variant: 'mobile',
      defaultOpen: true,
    });

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    const submit = form?.querySelector('button[type="submit"]');
    expect(submit?.textContent).toBe('Sign out');
    // Exactly one sign-out affordance in the panel — nothing else submits.
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('lifts both menu items to the 44px touch-target floor', async () => {
    await renderMenu({
      userEmail: 'marta@example.com',
      variant: 'desktop',
      defaultOpen: true,
    });

    // `min-h-11` is 2.75rem = 44px in Tailwind's spacing scale — the floor
    // docs/ui.md records for touch targets. Typography and padding are
    // unchanged; the floor only guarantees the minimum height.
    const profile = document.querySelector('a[href="/profile"]');
    const signOut = document.querySelector('form button');
    expect(profile?.className).toContain('min-h-11');
    expect(signOut?.className).toContain('min-h-11');
    expect(profile?.className).toContain('text-sm');
    expect(signOut?.className).toContain('text-sm');
  });
});

describe('AccountMenu before the client takes over', () => {
  function renderServerMarkup(variant: 'desktop' | 'mobile'): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      createElement(AccountMenu, { userEmail: 'marta@example.com', variant }),
    );
    return container;
  }

  it('shows the reachable profile link and sign-out form in the server markup', () => {
    const container = renderServerMarkup('desktop');

    expect(container.querySelector('a[href="/profile"]')?.textContent).toContain('Profile');
    expect(container.querySelector('form button[type="submit"]')?.textContent).toBe('Sign out');
  });

  it('keeps the pre-hydration control in the hydrated trigger footprint', async () => {
    // Desktop pill: the visible fallback control is exactly the box the
    // interactive trigger occupies, so the right-aligned slot cannot shift
    // when hydration swaps the two.
    const serverDesktop = renderServerMarkup('desktop');
    const mountedDesktop = await renderMenu({
      userEmail: 'marta@example.com',
      variant: 'desktop',
    });
    expect(serverDesktop.querySelector('a[href="/profile"]')?.className).toBe(
      mountedDesktop.querySelector('button')?.className,
    );

    // Mobile avatar: the same contract at the other breakpoint.
    const serverMobile = renderServerMarkup('mobile');
    const mountedMobile = await renderMenu({ userEmail: 'marta@example.com', variant: 'mobile' });
    expect(serverMobile.querySelector('a[href="/profile"]')?.className).toBe(
      mountedMobile.querySelector('button')?.className,
    );
  });

  it('keeps the secondary native action out of the slot width', () => {
    const container = renderServerMarkup('desktop');

    // The sign-out form is out of flow, so it cannot widen the slot or push
    // the pill: the footprint asserted above is the pill alone.
    const form = container.querySelector('form');
    expect(form?.className).toContain('absolute');
    expect(form?.className).toContain('right-full');
  });

  it('never renders the interactive menu before hydration', () => {
    const container = renderServerMarkup('desktop');

    // No inert trigger and no second control: an unloaded bundle, a failed
    // hydration or disabled scripting leaves exactly the native controls above
    // — which is what keeps Profile and Sign out reachable.
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('keeps the native avatar for assistive tech on mobile', () => {
    const container = renderServerMarkup('mobile');

    const control = container.querySelector('a[href="/profile"]');
    expect(control?.getAttribute('aria-label')).toBe('Profile');
    // Same 44px hit area / 32px circle split as the hydrated trigger, so the
    // two states share one footprint contract.
    expect(control?.className).toContain('size-11');
    expect(control?.querySelector('span[aria-hidden="true"]')?.className).toContain('size-8');
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });
});

describe('AccountMenu hydration', () => {
  it('swaps the native fallback for the interactive menu when the client takes over', async () => {
    const props = { userEmail: 'marta@example.com', variant: 'desktop' } as const;
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Hydration-compatible server markup, exactly what the server sends.
    container.innerHTML = renderToString(createElement(AccountMenu, props));

    // Before the client takes over — an unloaded bundle, a hydration that never
    // completes, or scripting unavailable: the native controls are reachable
    // and no inert menu is rendered.
    expect(container.querySelector('a[href="/profile"]')).not.toBeNull();
    expect(container.querySelector('form button[type="submit"]')?.textContent).toBe('Sign out');
    expect(container.querySelector('[aria-expanded]')).toBeNull();

    const root = hydrateRoot(container, createElement(AccountMenu, props));
    mounted.push({ container, root });
    await act(async () => {});

    // After hydration: the interactive menu is in place and the native controls
    // are gone, so exactly one account affordance is ever visible.
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('a[href="/profile"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });
});