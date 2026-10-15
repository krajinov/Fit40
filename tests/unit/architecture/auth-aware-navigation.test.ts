/**
 * M19 S3 architecture guards — authentication-aware navigation.
 *
 * Source-level invariants that the behavioral tests cannot express:
 * 1. the navigation model is server-safe and feature-free;
 * 2. the shell holds exactly ONE authentication state, resolved once by the
 *    route-group layout (no fetch/cookie/localStorage in the shell);
 * 3. destinations are declared once (no hardcoded private paths in the nav
 *    components), filtered by the auth flag;
 * 4. sign-in always targets /login and the shell never builds a `next=`
 *    parameter (the validated login flow stays the only producer);
 * 5. the S4-preserved contracts (session-route hide, tab-bar clearance) are
 *    untouched by this slice.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` convention). */
const ROOT = process.cwd();

const NAV_ITEMS = 'src/components/shared/nav-items.ts';
const APP_NAV_LINKS = 'src/components/shared/AppNavLinks.tsx';
const MOBILE_TAB_BAR = 'src/components/shared/MobileTabBar.tsx';
const APP_HEADER = 'src/components/shared/AppHeader.tsx';
const MOBILE_HEADER = 'src/components/shared/MobileHeader.tsx';
const APP_LAYOUT = 'src/app/(app)/layout.tsx';

const SHELL_FILES = [NAV_ITEMS, APP_NAV_LINKS, MOBILE_TAB_BAR, APP_HEADER, MOBILE_HEADER];

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Source with comments stripped, so prose never satisfies (or fails) a guard. */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('M19 S3 — the navigation model is server-safe', () => {
  it('nav-items.ts has no client directive, router import or feature import', () => {
    const source = code(NAV_ITEMS);

    expect(source).not.toMatch(/^['"]use (client|server)['"]/m);
    expect(source).not.toMatch(/from ['"]next\//);
    expect(source).not.toMatch(/@\/features/);
    expect(source).not.toMatch(/\buse(State|Effect|Reducer|SyncExternalStore)\b/);
  });
});

describe('M19 S3 — the shell owns no second authentication state', () => {
  it('no shell navigation file reads a cookie, storage or a client fetch', () => {
    for (const file of SHELL_FILES) {
      const source = code(file);
      expect(source, file).not.toMatch(/document\.cookie/);
      expect(source, file).not.toMatch(/localStorage|sessionStorage/);
      expect(source, file).not.toMatch(/\bfetch\(/);
      expect(source, file).not.toMatch(/getCurrentUser|requireUser/);
    }
  });

  it('the route-group layout resolves the session exactly once and threads one boolean', () => {
    const source = code(APP_LAYOUT);

    expect(source.match(/await getCurrentUser\(\)/g)).toHaveLength(1);
    expect(source).toContain('const isAuthenticated = user !== null;');
    expect(source.match(/isAuthenticated=\{isAuthenticated\}/g)).toHaveLength(3);
  });

  it('the shell navigation components import no feature module', () => {
    for (const file of SHELL_FILES) {
      expect(code(file), file).not.toMatch(/@\/features/);
    }
  });
});

describe('M19 S3 — destinations are declared once and filtered by auth', () => {
  it('the nav components hardcode no destination path', () => {
    for (const file of [APP_NAV_LINKS, MOBILE_TAB_BAR]) {
      const source = code(file);
      expect(source, file).not.toMatch(/['"]\/(dashboard|programs|exercises|history|progress)['"]/);
    }
  });

  it('both consumers go through the declared filter', () => {
    expect(code(APP_NAV_LINKS)).toContain('visibleNavItems(');
    expect(code(MOBILE_TAB_BAR)).toContain('authenticatedMobileTabs(');
  });

  it('the signed-out tab bar is disabled before any destination renders', () => {
    const source = code(MOBILE_TAB_BAR);

    // The auth check precedes the render path: an early return for a
    // signed-out visitor, so no private destination can be emitted.
    expect(source).toMatch(/if \(!isAuthenticated\) \{\s*return null;\s*\}/);
  });
});

describe('M19 S3 — sign-in flow and preserved contracts', () => {
  it('the sign-in controls target /login and the shell builds no next= parameter', () => {
    for (const file of [APP_HEADER, MOBILE_HEADER]) {
      const source = code(file);
      expect(source, file).toContain('href="/login"');
      expect(source, file).not.toContain('next=');
    }
    for (const file of [NAV_ITEMS, APP_NAV_LINKS, MOBILE_TAB_BAR]) {
      expect(code(file), file).not.toContain('next=');
    }
  });

  it('preserves the session-route tab-bar hide and the layout clearance', () => {
    expect(code(MOBILE_TAB_BAR)).toContain("endsWith('/session')");
    expect(code(APP_LAYOUT)).toContain(
      'pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0',
    );
  });
});
