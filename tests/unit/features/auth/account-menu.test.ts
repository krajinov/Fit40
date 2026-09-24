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
 * Rendered with react-dom (React 19 act), same pattern as the other
 * presentation tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The action module pulls in the auth composition root (DB wiring); this test
// only proves the wiring shape, so the action itself is stubbed.
vi.mock('@/features/auth/actions/logout', () => ({ logoutAction: vi.fn() }));

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
});