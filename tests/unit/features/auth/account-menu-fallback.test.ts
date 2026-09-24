/**
 * @vitest-environment jsdom
 *
 * Server-render tests for the account controls shown until the interactive
 * menu takes over (PR #16 review). `renderToStaticMarkup` runs neither effects
 * nor the client bundle, so its output is exactly what a browser receives
 * before — or entirely without — hydration.
 *
 * `logoutAction` is stubbed with a marker string so the markup shows what the
 * component hands to the form: the module's action as an ordinary native form
 * action, with nothing wrapped around it (a client handler would render
 * differently and fail the assertion). The real export is a `'use server'`
 * action, which React/Next render as a `method="POST"` form carrying its
 * action fields — the framework's contract, and the same one the pre-existing
 * `LogoutButton` form relied on.
 */

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The action module pulls in the auth composition root (DB wiring); this test
// only proves the wiring shape, so the action itself is stubbed.
vi.mock('@/features/auth/actions/logout', () => ({ logoutAction: '/__logout-action' }));

import { AccountMenuFallback } from '@/features/auth/components/AccountMenuFallback';

function renderFallback(variant: 'desktop' | 'mobile'): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    createElement(AccountMenuFallback, { userEmail: 'marta@example.com', variant }),
  );
  return container;
}

describe('AccountMenuFallback', () => {
  it('keeps the desktop profile link reachable in the server markup', () => {
    const container = renderFallback('desktop');

    const link = container.querySelector('a[href="/profile"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Profile');
    expect(link?.textContent).toContain('M');
    // The locked-design pill, unchanged from the control it stands in for.
    expect(link?.className).toContain('rounded-pill');
    expect(link?.querySelector('span[aria-hidden="true"]')?.className).toContain(
      'bg-accent-tint',
    );
  });

  it('keeps the mobile profile link, labelled for assistive tech', () => {
    const container = renderFallback('mobile');

    const link = container.querySelector('a[href="/profile"]');
    expect(link?.getAttribute('aria-label')).toBe('Profile');
    expect(link?.textContent).toBe('M');
    expect(link?.className).toContain('rounded-pill');
  });

  it('submits sign-out natively to the module action, with no client wiring', () => {
    const container = renderFallback('desktop');

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('action')).toBe('/__logout-action');
    expect(form?.querySelector('button[type="submit"]')?.textContent).toBe('Sign out');
    // The real mutation path only — one form, one control.
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('carries no noscript or stylesheet workaround', () => {
    const container = renderFallback('desktop');

    // The swap is React state, not a CSS/JS-detection trick: nothing here may
    // reintroduce the removed <noscript>/global-CSS mechanism.
    expect(container.querySelectorAll('noscript')).toHaveLength(0);
    expect(container.querySelectorAll('style')).toHaveLength(0);
  });
});