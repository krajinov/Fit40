/**
 * M19 S4 architecture guards — mobile navigation integrity.
 *
 * Source-level invariants behind the S4 behavior that component tests cannot
 * express on their own:
 * 1. the 76px bottom-bar slot and the layout's content clearance stay the two
 *    halves of ONE geometry (slot + safe-area inset), and the bar's vertical
 *    padding is fixed-pixel so a user-enlarged base font size can never consume
 *    the slot and push the tap targets below the 44px floor;
 * 2. there is exactly ONE fixed bottom bar per route family: the global tab bar
 *    (hidden on `/session`) or the session finish bar — never both, never a
 *    third;
 * 3. four equal slots can always shrink to the viewport, so the bar can never
 *    introduce horizontal page scrolling;
 * 4. History stays discoverable on mobile without a fifth tab (desktop nav +
 *    the dashboard's Recent training entry point), and the S3 auth-aware
 *    wordmark destinations are untouched;
 * 5. every mobile navigation target keeps the documented 44px floor.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { authenticatedMobileTabs, visibleNavItems } from '@/components/shared/nav-items';

/** Source with comments stripped, so prose never satisfies (or fails) a guard. */
function source(file: string): string {
  return readFileSync(path.resolve(file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const MOBILE_TAB_BAR = 'src/components/shared/MobileTabBar.tsx';
const MOBILE_HEADER = 'src/components/shared/MobileHeader.tsx';
const APP_NAV_LINKS = 'src/components/shared/AppNavLinks.tsx';
const APP_LAYOUT = 'src/app/(app)/layout.tsx';
const DASHBOARD_PAGE = 'src/app/(app)/dashboard/page.tsx';
const RECENT_TRAINING_CARD = 'src/features/dashboard/components/RecentTrainingCard.tsx';

const SHELL_FILES = [MOBILE_TAB_BAR, APP_NAV_LINKS, MOBILE_HEADER];
const SLOT_TOKEN = '--mobile-tab-bar-height';

describe('M19 S4 — bottom-bar geometry and content clearance', () => {
  it('keeps the 76px floor, the safe-area padding and the md:hidden hide', () => {
    const bar = source(MOBILE_TAB_BAR);

    expect(bar).toContain(`min-h-[var(${SLOT_TOKEN})]`);
    expect(bar).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(bar).toContain('md:hidden');
  });

  it('keeps the bar padding fixed-pixel so font scaling cannot consume the slot', () => {
    const bar = source(MOBILE_TAB_BAR);

    // The row is the slot: rem-scaled vertical padding (`pt-2 pb-4`) grows with
    // the user's base font size and is what used to squeeze the 52px targets down
    // to 40px (150% text) and 28px (200% text).
    expect(bar).toMatch(/min-h-\[var\(--mobile-tab-bar-height\)\][^"]*pt-\[8px\] pb-\[16px\]/);
    expect(bar).not.toMatch(/\bpt-2\b/);
    expect(bar).not.toMatch(/\bpb-4\b/);
  });

  it('defines ONE slot token that both the bar and the clearance consume', () => {
    const layout = source(APP_LAYOUT);
    const bar = source(MOBILE_TAB_BAR);
    const tokens = source('src/app/globals.css');

    // The locked 76px floor stays, and the slot only grows when an enlarged base
    // font needs the extra height (icon + gap + label line box + paddings).
    expect(tokens).toMatch(
      /--mobile-tab-bar-height:\s*max\(76px,\s*calc\(48px \+ 1\.25rem\)\)/,
    );
    expect(layout).toContain(`pb-[calc(var(${SLOT_TOKEN})+env(safe-area-inset-bottom))] md:pb-0`);
    expect(bar).toContain(`min-h-[var(${SLOT_TOKEN})]`);
    // No hard-coded copy of the slot may survive in the layout.
    expect(layout).not.toMatch(/pb-\[calc\(76px/);
  });

  it('never lets the row compress a label below its line box', () => {
    const bar = source(MOBILE_TAB_BAR);

    // `truncate` sets overflow:hidden, which zeroes the column flex item's
    // automatic minimum size — that is what clipped the label at 200% text.
    expect(bar).toMatch(/max-w-full min-w-0 shrink-0 truncate text-xs/);
  });

  it('lets the tab slots shrink so the bar never scrolls the page sideways', () => {
    const bar = source(MOBILE_TAB_BAR);

    expect(bar).toMatch(/flex min-w-0 flex-1 flex-col/);
    expect(bar).toContain('max-w-full');
  });
});

describe('M19 S4 review — the compact header wraps instead of losing labels', () => {
  it('makes the header and its nav wrapping rows with a growable minimum height', () => {
    const header = source(MOBILE_HEADER);
    const nav = source(APP_NAV_LINKS);

    expect(header).toContain('flex min-h-16 flex-wrap items-center');
    expect(header).not.toMatch(/(^|\s)h-16(\s|$)/);
    // The compact nav is a WRAPPING row that keeps its natural width.
    expect(nav).toMatch(/flex flex-wrap items-center gap-1/);
    // It must not grow or shrink either. A shrinking nav is squeezed to nothing
    // (the pre-review bug); a `flex-1` nav is placed on the header's first line
    // with a zero basis and wraps its own links into a narrow column beside the
    // sign-in control, which renders the second destination BELOW the sign-in
    // link while the tab order still reaches it first (S4 review fix, P2).
    expect(nav).not.toMatch(/(^|\s)flex-1(\s|$)/);
    expect(nav).not.toMatch(/\bmin-w-0\b/);
  });

  it('keeps the public labels whole: no truncation, no ellipsis, full text', () => {
    const nav = source(APP_NAV_LINKS);

    expect(nav).toMatch(/flex min-h-11 shrink-0 items-center px-1 text-sm/);
    expect(nav).not.toContain('truncate');
    expect(nav).not.toContain('text-ellipsis');
  });
});

describe('M19 S4 — one bottom bar per route family', () => {
  it('keeps the global tab bar hidden on session routes', () => {
    expect(source(MOBILE_TAB_BAR)).toContain("if (pathname.endsWith('/session')) {");
  });

  it('keeps the session finish bar composed only by the active-workout screen', () => {
    // The repo-wide scan (single source of truth for "which files can render a
    // bottom bar") lives in mobile-bottom-bars.test.ts, which also asserts the
    // completed-session and History-detail composition.
    expect(source('src/features/sessions/components/ActiveWorkoutScreen.tsx')).toContain('<SessionFinishBar');
  });
});

describe('M19 S4 — History discoverability without a fifth tab', () => {
  it('keeps the authenticated mobile tab set at the locked four', () => {
    expect(authenticatedMobileTabs().map((tab) => tab.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/progress',
    ]);
    const tabs = authenticatedMobileTabs().map((tab) => tab.href);
    expect(tabs).not.toContain('/history');
    expect(tabs).not.toContain('/profile');
  });

  it('keeps History reachable from the desktop destinations', () => {
    expect(visibleNavItems(true).map((item) => item.href)).toContain('/history');
  });

  it('keeps the dashboard Recent training card as the mobile History entry point', () => {
    expect(source(DASHBOARD_PAGE)).toContain('<RecentTrainingCard');
    const card = source(RECENT_TRAINING_CARD);
    expect(card).toContain('href="/history"');
    // The entry point is a real touch target, not a 20px inline text link.
    expect(card).toMatch(/inline-flex min-h-\[44px\] items-center self-start[^"]*"[\s\S]*?View all training history/);
  });
});

describe('M19 S4 — landmarks, active state and target floors', () => {
  it('keeps one Primary landmark per breakpoint and aria-current on the active tab', () => {
    const bar = source(MOBILE_TAB_BAR);

    expect(bar).toContain('aria-label="Primary"');
    expect(bar).toContain("aria-current={active ? 'page' : undefined}");
    expect(bar).toContain('aria-hidden="true"');
    expect(bar).toContain('focus-visible:ring-3');
  });

  it('keeps the mobile shell free of feature imports and of a second auth state', () => {
    for (const file of SHELL_FILES) {
      const shell = source(file);
      expect(shell, file).not.toMatch(/@\/features/);
      expect(shell, file).not.toMatch(/getCurrentUser|requireUser/);
    }
  });

  it('keeps every mobile navigation target at or above the 44px floor', () => {
    // Tab slots are stretched to the 52px content box of the 76px slot.
    expect(source(MOBILE_TAB_BAR)).toContain('items-stretch');
    // The compact header links keep the 44px `min-h-11` floor.
    expect(source(APP_NAV_LINKS)).toMatch(/flex min-h-11 shrink-0 items-center px-1 text-sm/);
    // …and the signed-out sign-in control now floors at 44px too.
    expect(source(MOBILE_HEADER)).toContain('inline-flex min-h-[44px] items-center');
  });
});

describe('M19 S4 — preserved S3 authentication contracts', () => {
  it('keeps the wordmark destinations auth-aware and the sign-in target /login', () => {
    expect(source(MOBILE_HEADER)).toContain("href={isAuthenticated ? '/dashboard' : '/'}");
    expect(source(MOBILE_HEADER)).toContain('href="/login"');
    expect(source(APP_NAV_LINKS)).toContain('visibleNavItems(isAuthenticated)');
  });

  it('keeps the mobile header nav limited to signed-out visitors', () => {
    expect(source(MOBILE_HEADER)).toMatch(/\{!isAuthenticated && <AppNavLinks/);
  });
});
