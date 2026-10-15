/**
 * M19 S3: the navigation model itself. `nav-items.ts` is the single declarative
 * source of truth for destinations, labels, the auth requirement and the
 * locked mobile tab set — these tests pin the data contract that the shell
 * components (and the architecture guard) rely on.
 */

import { describe, expect, it } from 'vitest';

import {
  NAV_ITEMS,
  authenticatedMobileTabs,
  isActivePath,
  visibleNavItems,
} from '@/components/shared/nav-items';

describe('NAV_ITEMS — the locked destinations', () => {
  it('declares the five destinations once, in locked order', () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/history',
      '/progress',
    ]);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Dashboard',
      'Programs',
      'Exercises',
      'History',
      'Progress',
    ]);
  });

  it('marks exactly the private destinations as requiring authentication', () => {
    const privateHrefs = NAV_ITEMS.filter((item) => item.requiresAuth).map((item) => item.href);
    const publicHrefs = NAV_ITEMS.filter((item) => !item.requiresAuth).map((item) => item.href);

    expect(privateHrefs).toEqual(['/dashboard', '/history', '/progress']);
    expect(publicHrefs).toEqual(['/programs', '/exercises']);
  });

  it('never declares /profile as a navigation destination', () => {
    expect(NAV_ITEMS.some((item) => item.href === '/profile')).toBe(false);
  });
});

describe('visibleNavItems — the auth filter', () => {
  it('shows only the public catalog when signed out', () => {
    expect(visibleNavItems(false).map((item) => item.href)).toEqual(['/programs', '/exercises']);
  });

  it('shows every destination, in locked order, when signed in', () => {
    expect(visibleNavItems(true).map((item) => item.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/history',
      '/progress',
    ]);
  });
});

describe('authenticatedMobileTabs — the locked four-tab bar', () => {
  it('resolves Home / Programs / Exercises / Progress, in order', () => {
    const tabs = authenticatedMobileTabs();

    expect(tabs.map((tab) => tab.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/progress',
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual([
      'Home',
      'Programs',
      'Exercises',
      'Progress',
    ]);
  });

  it('carries a real icon component for every tab', () => {
    for (const tab of authenticatedMobileTabs()) {
      expect(typeof tab.icon).toBe('object');
    }
  });

  it('never exposes Profile or History as a mobile tab', () => {
    const hrefs = authenticatedMobileTabs().map((tab) => tab.href);
    expect(hrefs).not.toContain('/profile');
    expect(hrefs).not.toContain('/history');
    expect(hrefs).toHaveLength(4);
  });
});

describe('isActivePath — locked active-route semantics', () => {
  it('activates on the exact route and on nested routes', () => {
    expect(isActivePath('/dashboard', '/dashboard')).toBe(true);
    expect(isActivePath('/history/exercises/goblet-squat', '/history')).toBe(true);
    expect(isActivePath('/programs/fit40-beginner-strength', '/programs')).toBe(true);
  });

  it('does not activate on a sibling path that merely shares a prefix', () => {
    expect(isActivePath('/progress-archive', '/progress')).toBe(false);
    expect(isActivePath('/programs', '/progress')).toBe(false);
    expect(isActivePath('/exercises', '/exercises/goblet-squat')).toBe(false);
  });
});
