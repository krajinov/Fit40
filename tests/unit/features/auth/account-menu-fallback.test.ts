/**
 * @vitest-environment jsdom
 *
 * Server-render tests for the no-JavaScript account fallback (PR #16 review,
 * P2 #2). The fallback is a Server Component, so the proof is the markup every
 * browser gets before hydration: a reachable `/profile` link and a native
 * sign-out form already present in the HTML, plus the rule that keeps exactly
 * one account affordance visible per state.
 *
 * `renderToStaticMarkup` is React's own server renderer — the output shape the
 * app ships. `logoutAction` is stubbed with a marker string so the markup
 * shows what the component hands to the form: the module's action as an
 * ordinary native form action, with nothing wrapped around it (a client
 * handler would render differently and fail the assertion). The real export is
 * a `'use server'` action, which React/Next render as a `method="POST"` form
 * carrying its action fields — the framework's contract, and the same one the
 * `LogoutButton` form has always relied on.
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
  it('keeps the desktop profile link in the server-rendered markup', () => {
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
    // The real mutation path only — no second form, no hidden affordance.
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('hides itself for scripted browsers and reveals itself only without scripting', () => {
    const container = renderFallback('desktop');

    // Hidden by globals.css for every browser that runs scripts.
    expect(container.firstElementChild?.className).toContain('account-menu-fallback');

    const noscript = container.querySelector('noscript');
    expect(noscript).not.toBeNull();
    expect(noscript?.textContent).toContain('.account-menu-fallback{display:flex}');
    expect(noscript?.textContent).toContain('.account-menu-trigger{display:none}');

    // That rule is the ONLY stylesheet in the fallback, and it sits inside the
    // element (jsdom parses its content as inert text here, exactly like a
    // scripting browser), so nothing else can reveal the fallback or hide the
    // menu trigger while scripting runs.
    expect(container.querySelectorAll('style')).toHaveLength(0);
  });
});