# Milestone 19 — Slice 3 Implementation Report

**Slice:** S3 — Authentication-Aware Navigation
**Branch:** `feat/m19-s3-auth-navigation` (from `main` @ `2a68c0d2`, the merged S2)
**Scope:** S3 only. S1/S2 implementations and M8–M18 semantics are untouched. S4–S6 are not started.

## 1. Objective

Make the application shell's navigation reflect the current authentication
state, using the existing session infrastructure, without introducing a second
auth state and without any client-side auth flicker.

## 2. Locked contracts implemented

| State | Desktop header | Mobile header | Mobile tab bar |
|-------|----------------|---------------|----------------|
| Signed out | `Programs`, `Exercises` + `Sign in` | wordmark, `Programs`, `Exercises`, `Sign in` | **hidden entirely** |
| Signed in | `Dashboard`, `Programs`, `Exercises`, `History`, `Progress` + account menu | wordmark + account menu (no nav — the bar owns it) | `Home`, `Programs`, `Exercises`, `Progress` |

`Profile` is no longer a mobile tab; it stays reachable through the account menu
in both headers (its pre-hydration fallback is a native `/profile` link, which
S3 did not change).

## 3. Architecture

- **NEW `src/components/shared/nav-items.ts`** — the single declarative source
  of truth: `href`, desktop label, optional mobile label, icon, `requiresAuth`
  and `mobileTab` per destination, plus three pure helpers
  (`visibleNavItems(isAuthenticated)`, `authenticatedMobileTabs()`,
  `isActivePath(pathname, href)`). It is server-safe: no `next/navigation`, no
  hook, no feature import — enforced by a source guard.
- **One authentication state.** `(app)/layout.tsx` already resolved the session
  (`getCurrentUser()`, `cache()`d); S3 derives a single
  `const isAuthenticated = user !== null` and threads it as a plain boolean to
  `AppHeader`, `MobileHeader` and `MobileTabBar`. No new read, no cookie read,
  no fetch, no client store — the server HTML already reflects the session, so
  there is nothing to switch after hydration.
- **No new navigation component.** The signed-out mobile header reuses the
  existing `AppNavLinks` with a `variant="mobileHeader"` layout (compact row,
  44px touch targets, same active-state semantics); the tab bar consumes the
  `nav-items` tab helper.
- **Authorization unchanged.** Nothing in the shell enforces or grants access;
  every private page keeps its own `requireUser()` and the login redirect with
  its `?next=` parameter is untouched.

## 4. Files changed

Added:
- `src/components/shared/nav-items.ts`
- `tests/unit/components/shared/nav-items.test.ts` (12 tests)
- `tests/unit/components/shared/mobile-tab-bar.test.ts` (6 tests)
- `tests/unit/architecture/auth-aware-navigation.test.ts` (8 tests)
- `docs/milestones/milestone-19-s3-report.md` (this file)

Modified:
- `src/components/shared/AppNavLinks.tsx` — auth-filtered items, second layout variant.
- `src/components/shared/AppHeader.tsx` — accepts and forwards `isAuthenticated`.
- `src/components/shared/MobileHeader.tsx` — signed-out public links; no nav when signed in.
- `src/components/shared/MobileTabBar.tsx` — `isAuthenticated` prop, early `null` for signed-out, tabs from `nav-items`.
- `src/app/(app)/layout.tsx` — one derived boolean threaded to three consumers.
- `tests/unit/components/shared/app-shell-headers.test.ts` — extended to cover both auth states, both breakpoints, active state and sign-in targets.
- `tests/unit/architecture/training-progress.test.ts` — the M18 tab assertion was updated to the locked M19 four-tab set (it pinned the old `Profile` tab, so it could not stay green).
- `docs/milestones/milestone-19-plan.md` — §9 note recording that the tab set and signed-out hide landed in S3.
- `docs/ui.md` — one correction to the stale `MobileTabBar` enumeration.

No dependency was added. No `loading.tsx` was (re)introduced; the S2 pre-stream
auth/validation architecture is untouched.
## 5. Tests added/updated

| Required coverage | Where |
|---|---|
| 1. Signed-out desktop navigation | `app-shell-headers.test.ts` — exactly `Programs`/`Exercises` + `Sign in`, and the three private labels absent from the markup |
| 2. Authenticated desktop navigation | same file — the locked five, in order, plus the account slot and no `/login` link |
| 3. Signed-out mobile navigation | same file + `mobile-tab-bar.test.ts` — header public links and `Sign in`; the tab bar renders **nothing** (empty container) |
| 4. Authenticated mobile navigation | `mobile-tab-bar.test.ts` — exactly `Home`/`Programs`/`Exercises`/`Progress`, no `/profile` link |
| 5. Sign-in and sign-out transitions | `app-shell-headers.test.ts` (both auth states through the same components) + the real-browser round trip in §7 |
| 6. Public navigation accessibility | `aria-label="Primary"` on every nav, 44px `min-h-11` targets in the signed-out mobile header, icons `aria-hidden` |
| 7. Active navigation state | `isActivePath` unit cases + rendered `aria-current="page"` assertions (desktop, mobile header, tab bar), including nested routes and the `/progress-archive` non-match |
| 8. Preservation of redirect destinations | sign-in controls assert `href="/login"`; the architecture guard asserts the shell builds no `next=` and never touches `requireUser`/`getCurrentUser` |
| 9. No hydration mismatch / unauthorized exposure | `mobile-tab-bar.test.ts` compares server (`renderToStaticMarkup`) vs client markup for both auth states — identical; the signed-out bar is empty in both. Guards assert the shell holds no cookie/storage/fetch auth state and exactly one server-resolved boolean |

The architecture guard also pins: `nav-items.ts` is server-safe, no shell file
imports `@/features`, the tab bar's `if (!isAuthenticated) return null` precedes
the render path, the `/session` hide and the layout's tab-bar clearance class
are unchanged, and the nav components hardcode no destination path.

## 6. Verification results

| Check | Command | Result |
|---|---|---|
| Focused S3 tests | `npx vitest run` (5 files: nav-items, mobile-tab-bar, app-shell-headers, auth-aware-navigation, training-progress) | **45 passed** |
| Full unit suite | `npx vitest run` | **224 files / 3072 tests passed** (pre-S3 baseline: 221 / 3040) |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Production build | `npx next build --webpack` | exit 0 |
| Whitespace | `git diff --check` | clean |

## 7. Browser verification (real Chrome, headless via CDP)

Chrome 155 headless was driven over the DevTools Protocol against the
production build (`next build --webpack` + `next start`). Screenshots were
captured and inspected.

| Check | Viewport | Observed |
|---|---|---|
| Signed-out header + no tab bar | 375×812 | header `Fit40 · Programs · Exercises · Sign in`; **no bottom bar**; no `/profile` link |
| Signed-out desktop nav | 1440×900 | desktop nav exactly `Programs`, `Exercises` + `Sign in`; no `Dashboard`/`History`/`Progress` |
| Real sign-up (Server Action form) | 1440 then 375 | registration succeeded and landed signed in (`/onboarding`) |
| Signed-in mobile tabs | 375×812 | bar = `Home · Programs · Exercises · Progress` with `Programs` active; header shows only the account avatar; no `Profile` tab |
| Real tab click | 375×812 | clicking `Progress` navigated to `/progress` and set `aria-current="page"` on the `Progress` tab (screenshot confirms the active accent + icon) |
| Real sign-out (account menu) | 375×812 | after signing out: tab bar gone, header back to `Programs · Exercises · Sign in`, `/login` present |

Screenshots (temporary, outside the repo): `/tmp/s3-6-mobile-signedout.png`,
`/tmp/s3-8-mobile-signedin.png`, `/tmp/s3-9-mobile-progress-active.png`,
`/tmp/s3-10-mobile-after-signout.png`, `/tmp/s3-2-desktop-signedout.png`,
`/tmp/s3-4-desktop-signedin.png`.

**Not verified in a browser:** tablet widths, Safari/Firefox, keyboard-tab and
screen-reader behaviour, and the signed-in *History* discoverability flow that
S4 owns.

## 8. Acceptance criteria

- [x] Signed out, desktop: `Programs`, `Exercises` + `Sign in`; no private item.
- [x] Signed out, mobile: no bottom tab bar; public catalog via the header; `Sign in`.
- [x] Signed in, desktop: the locked five.
- [x] Signed in, mobile: `Home`, `Programs`, `Exercises`, `Progress`; no `Profile` tab.
- [x] Active-route semantics identical in both auth states.
- [x] Labels, hrefs and the auth flag defined in one module (`nav-items.ts`).
- [x] Public catalog reachable signed out (header, verified in the browser).
- [x] One authentication state; no client auth fetch, cookie or storage read in the shell.
- [x] ≥44px touch targets in the new signed-out mobile links; focus rings preserved.
- [x] Login redirects and their `?next=` parameter untouched.

**Not covered by S3 (S4 scope):** safe-area/geometry integrity assertions, the
session-screen double-bar audit, History discoverability, and the remaining
README/ui.md documentation sweep. The M18 tab assertion was updated here only
because the locked S3 contract replaces the tab set it pinned.

## 9. Limitations and risks

- The browser round trip created two throwaway accounts in the local dev
  database (`s3review+…@example.com`, `s3mobile+…@example.com`); they have no
  profile data and exist only in the developer's local environment.
- The hydration-parity test compares server and client markup for the same
  props; the real-browser run exercises an actual hydration, but no
  React-reported mismatch was captured as an error signal.
- The signed-out mobile header adds links beside the existing `Sign in` control
  on very narrow viewports; verified at 375px only.
- `Sign in` retains its pre-existing tap height (the locked design); the new
  public links carry the 44px floor.

## 10. Commit

See the commit hash in the final response. Not pushed; no PR opened; S4 not started.

