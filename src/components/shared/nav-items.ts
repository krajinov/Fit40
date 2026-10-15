/**
 * Single declarative source of truth for the application shell's navigation
 * destinations (M19 S3).
 *
 * Server-safe by construction: no `next/navigation` import, no React hook, no
 * feature import, no state. The authentication decision arrives as a plain
 * `isAuthenticated` boolean prop from the route-group layout, which already
 * resolves the session once per request (`getCurrentUser()` is `cache()`d) —
 * so there is exactly ONE authentication state in the shell and the server
 * HTML already reflects it (no client-side auth flicker, no hydration switch).
 *
 * `requiresAuth` marks a destination that only works for an authenticated
 * visitor (its page calls `requireUser()` and would redirect). Signed-out
 * visitors must never see those rendered as available navigation.
 *
 * `mobileTab` marks the locked four-slot bottom bar (M19 S3 contract):
 * Home / Programs / Exercises / Progress. Profile is deliberately NOT a tab —
 * it stays reachable through the account menu composed into both headers.
 */
import {
  Dumbbell,
  Home,
  ListChecks,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Route the destination links to (public routes work signed in or out). */
  readonly href: string;
  /** Desktop header label. */
  readonly label: string;
  /** Mobile tab label when the locked design differs from the desktop one. */
  readonly mobileLabel?: string;
  /** Mobile tab icon (22px set). Required for `mobileTab` entries. */
  readonly icon?: LucideIcon;
  /** True when the destination only works for an authenticated visitor. */
  readonly requiresAuth: boolean;
  /** True when the destination is one of the four locked mobile tabs. */
  readonly mobileTab: boolean;
}

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    mobileLabel: 'Home',
    icon: Home,
    requiresAuth: true,
    mobileTab: true,
  },
  { href: '/programs', label: 'Programs', icon: Dumbbell, requiresAuth: false, mobileTab: true },
  { href: '/exercises', label: 'Exercises', icon: ListChecks, requiresAuth: false, mobileTab: true },
  // No tab: `/history` is reached from the dashboard's Recent training card
  // (its documented mobile entry point) and from exercise-history pages.
  { href: '/history', label: 'History', requiresAuth: true, mobileTab: false },
  { href: '/progress', label: 'Progress', icon: TrendingUp, requiresAuth: true, mobileTab: true },
];

/** A resolved mobile tab: the shape the tab bar renders. */
export interface MobileTab {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/**
 * Destinations a visitor in this authentication state can actually use.
 * Signed-out: the public catalog only (`/programs`, `/exercises`).
 * Signed-in: every destination, in locked order.
 */
export function visibleNavItems(isAuthenticated: boolean): ReadonlyArray<NavItem> {
  if (isAuthenticated) {
    return NAV_ITEMS;
  }
  return NAV_ITEMS.filter((item) => !item.requiresAuth);
}

/**
 * The four locked authenticated mobile tabs, in locked order. The invariant
 * (a tab must carry both a label and an icon) is enforced here rather than
 * assumed at the call site, so a malformed entry fails loudly in development
 * and in tests instead of rendering an unnamed tab.
 */
export function authenticatedMobileTabs(): ReadonlyArray<MobileTab> {
  const tabs: MobileTab[] = [];
  for (const item of NAV_ITEMS) {
    if (!item.mobileTab) {
      continue;
    }
    if (item.icon === undefined) {
      throw new Error(`Navigation item "${item.href}" is a mobile tab without an icon`);
    }
    tabs.push({ href: item.href, label: item.mobileLabel ?? item.label, icon: item.icon });
  }
  return tabs;
}

/**
 * Active-route semantics (locked, unchanged by M19 S3): a destination is
 * active on its own route and on nested routes beneath it, but never on a
 * sibling whose path merely starts with the same characters (`/progress` must
 * not activate for `/progress-archive`).
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
