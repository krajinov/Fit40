# M19 Slice 6 — UX Polish & Regression Coverage

## Base and scope

Branch `feat/m19-s6-ux-polish`, created from `origin/main` at `68c65b42`
(which contains S1–S5: PRs #24–#28). Scope is S6 only: landing cleanup,
context-aware 404, sign-in-and-continue regression tests, History
discoverability verification, navigation copy/a11y verification, responsive
regression evidence and the M19 architecture guard.

No database migration, new metric, persisted state, dependency, navigation
redesign or fifth tab. No M8–M18 business semantic or owned copy changed.

## Changes and files affected

| File | Change |
|---|---|
| `src/app/page.tsx` | Removed the leftover `LogoutButton` usage. Signed-in visitors keep the single Dashboard CTA; signed-out visitors keep Create account / Sign in. |
| `src/features/auth/components/LogoutButton.tsx` | Deleted: the landing page was its only consumer (plan D5). Sign-out remains owned solely by the account menu in both headers. |
| `src/app/not-found.tsx` | Context-aware 404. Reads only the session cookie's presence (`getSessionToken`) — no `getCurrentUser()`, no `requireUser()`, no database read. Signed out: exercise catalog + Sign in. Signed in: exercise catalog + Go to your dashboard. Navigation is a named `nav`, every link is a 44px target with the standard focus ring. |
| `tests/unit/app/landing-page.test.ts` | New: both auth states, Dashboard CTA preserved, no sign-out control/form. |
| `tests/unit/app/not-found-page.test.ts` | New: shared 404 surface, both auth states, private destinations absent signed out, 44px targets, internal-only hrefs. |
| `tests/unit/features/sessions/workout-start-panel.test.ts` | +2 regression tests: anonymous sign-in-and-continue preserves the exact session path through the validated `next` parameter; not-enrolled joins via the session route with no login hop. |
| `tests/unit/architecture/m19-navigation-integrity.test.ts` | New: 21 M19 guards (see below). |
| `tests/unit/features/auth/account-menu-fallback.test.ts` | Comment only: removed the stale reference to the deleted `LogoutButton`; no behavioral change. |
| `docs/ui.md` | Replaced the stale "landing still renders `LogoutButton`" note with the shipped sign-out ownership. |
| `docs/error-handling.md` | Documented the context-aware 404's no-redirect/no-database contract. |

## Acceptance criteria and evidence

1. **Landing logout removed; Dashboard CTA kept.** Unit test covers both auth
   states; production HTTP confirms `/` signed-in renders only
   `href="/dashboard"` and no "Sign out", signed-out renders `/register` and
   `/login`.
2. **Context-aware 404 with native semantics.** HTTP probes return **404** in
   both auth states. Signed out: `/exercises` + `/login`. Signed in:
   `/exercises` + `/dashboard`. No redirect or authorization helper is imported
   by the page (guard). The page performs no database read.
3. **Sign-in-and-continue verified, not rebuilt.** The anonymous CTA is still
   `Sign in to start` with `/login?next=` + `encodeURIComponent(sessionPath)`;
   the test decodes `next`, asserts it equals the session route and passes
   `nextPathSchema`. Not-enrolled keeps its direct session link. No second
   redirect-validation mechanism was added.
4. **Mobile History reachability.** No new link was required. The dashboard
   composes `RecentTrainingCard` at every breakpoint and its
   "View all training history" link is a 44px target. Measured at 375px: link
   box 44×156, bottom 663, tab-bar top 735, hit-test hits the link, page overflow
   0. The guard pins the dashboard composition, the link and the four-tab set.
5. **Navigation copy and accessibility.** `nav-items.ts` remains the single
   source; no shell component hard-codes a route. Guards pin `aria-label="Primary"`,
   `aria-current="page"`, focus-visible rings, 44px mobile targets and the absence
   of `tabIndex` overrides. A real keyboard walk is recorded below.
6. **Responsive regression.** Both auth states were rendered at 375px and
   1440px in Chrome (below). Jsdom/HTTP alone are not presented as layout proof.

## Architecture guard

`tests/unit/architecture/m19-navigation-integrity.test.ts` covers:

- navigation isolation: no `@/features` import under `src/components/shared/`,
  no hard-coded destinations in `AppNavLinks`/`MobileTabBar`, server-safe
  `nav-items.ts`;
- exactly four authenticated mobile tabs in order, no History/Profile tab,
  private destinations absent from signed-out navigation, `MobileTabBar` returns
  `null` when unauthenticated;
- History reachability through the dashboard card, not a tab;
- nav copy/a11y contracts (`Primary`, `aria-current`, focus rings, 44px);
- safe redirects: only the three existing `/login?next=${encodeURIComponent(…)}`
  producers, `nextPathSchema` at every auth boundary, external targets rejected,
  404 free of redirect/authorization/database imports;
- feature boundaries: `src/features/exercises/**` (except `services.ts`) imports
  no port, infrastructure or Drizzle;
- error privacy: boundaries and `ErrorState` render no `error.message`,
  `error.stack` or `{error}`;
- banned vocabulary in the two S6 copy files, and no `any`, non-null assertions
  or TS suppressions in them;
- S2 adaptation: **zero** `loading.tsx`, exactly one `RoutePlaceholder`
  definition, and page-level `Suspense` + `RoutePlaceholder` on the five
  streamed routes;
- no `Date.now()` in Domain or Application.

## Test results

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | **232 files / 3,129 tests passed** (baseline 229 / 3,100; +3 files, +29 tests) |
| `npm run test:integration` | **50 files / 500 tests passed** |
| `npm run build -- --webpack` | exit 0 |
| New/changed S6 tests alone | 4 files / 32 tests passed |

The build reports all routes as dynamic (`ƒ`), including `/_not-found`, because
the 404 now reads the session cookie. Turbopack was not run; only the requested
webpack build is verified.

## Manual browser checks actually performed

Production build served on `http://127.0.0.1:3210`, driven by headless Google
Chrome 155.0.8059.80 over CDP with a temporary database-backed session (deleted
afterwards). Screenshots were inspected but are not committed.

| Check | Result |
|---|---|
| 375px signed-out `/programs` | One visible header nav: Programs 44×73, Exercises 44×72; no tab bar; page overflow 0. |
| 375px signed-in `/dashboard` | Fixed tab bar at top 735, height 77; four 52×84 tabs Home/Programs/Exercises/Progress; Home `aria-current="page"`; overflow 0. |
| History at 375px | "View all training history" 44×156, bottom 663 vs bar top 735; not covered; hit-test hits the link. |
| Profile at 375px | Account trigger 44×44; click opens `role="menu"` ("Profile", "Sign out"); Profile link 44px; clicking it navigated to `/profile`; Sign out 44px. |
| Keyboard walk at 375px | Tab order: Fit40 home → Account → View progress → Edit profile → Resume workout → View details → Set training days → View all training history; each focused control exposed a non-`none` box-shadow focus ring. |
| Session route at 375px | Tab bar hidden; exactly one fixed bottom bar, "Finish workout"; no overlapping bars. |
| 375px 404, signed in / out | 404 heading; catalog + dashboard, or catalog + sign-in; every link 44px. |
| 1440px signed-out `/exercises` | Header links Programs, Exercises + Sign in; tab bar not visible. |
| 1440px signed-in `/dashboard` | Five header links in order with Dashboard active; tab bar not visible; overflow 0. |

HTTP probes: signed-out `/dashboard` → `307 /login?next=%2Fdashboard`;
signed-in `/dashboard`, `/history`, `/profile`, `/exercises`, `/programs` →
`200`; unknown URL → `404` with the links above. Server log showed no errors.

## Remaining limitations

- No 393px run, real device, safe-area device, screen reader or OS text-size
  settings. The browser run used 100% text at 375/1440px. S4's 150%/200% text
  evidence remains the reference for enlarged text.
- The 404 trusts the session cookie's presence rather than validating the
  session. A stale cookie shows "Go to your dashboard"; following it runs that
  page's `requireUser()` and the existing validated login redirect. Validating
  here would add a database dependency to a 404, which the slice explicitly
  avoids.
- The 404 is now dynamically rendered (cookie read) instead of prerendered.
- Breakpoint/layout behavior is not asserted by a committed automated test.
  The jsdom and HTTP tests cannot prove CSS geometry; browser evidence above is
  manual, not E2E.
- Turbopack was not run.

## Deviations from the original plan

1. **§11.1 "every `loading.tsx` imports RoutePlaceholder" is obsolete.** S2
   removed every `loading.tsx` deliberately to preserve native redirects/404s.
   The guard instead asserts zero `loading.tsx`, one `RoutePlaceholder`
   definition, and page-level `Suspense` + `RoutePlaceholder` on the five
   streamed routes. No `loading.tsx` was reintroduced.
2. **404 uses cookie presence, not `getCurrentUser()`.** This satisfies the
   signed-in/signed-out copy requirement while adding no database read and no
   new failure mode on an otherwise static dead end.
3. **`LogoutButton.tsx` was deleted, not merely unimported** (plan D5): it had
   no other consumer.
4. **No dashboard History link was added** (plan D4): the existing 44px
   "View all training history" link is reachable and clear of the tab bar at
   375px.
5. **No global source sweep.** Guards are scoped to S6 files and the exact
   shell/feature surfaces; class-format responsive guards were not reintroduced
   (S4 had removed them in favor of behavioral tests).

## Independent review fixes (after `cadf395`)

The independent review found no P1/P2 defects and two P3 issues:

1. **Authentication destination coverage.** The original tests checked the
   workout CTA's encoding and schema separately, without following the actual
   login-page/action redirect. New
   `tests/unit/features/auth/sign-in-and-continue.test.ts` adds 25 behavioral
   cases using the existing Vitest mocks. The real anonymous workout CTA feeds
   the real login page and rendered `LoginForm`; its hidden destination is
   submitted to the real successful `loginAction`, asserting the exact final
   session redirect and session-cookie establishment. Unsafe absolute,
   protocol-relative, backslash, encoded-slash/backslash, script and empty
   destinations fall back to `/dashboard` both through the page and when
   submitted directly to bypass page sanitization. Missing/repeated query
   parameters and already-authenticated login-page redirects are also covered.
   The architecture guard now includes `register/page.tsx` alongside the login
   page and both auth actions. No production authentication defect was found.
2. **404 documentation accuracy.** `docs/error-handling.md` now limits the
   no-database-read guarantee to the fallback component itself. Enclosing
   layouts and route-specific lookups may access the database and propagate
   unexpected failures; native 404 and destination authentication contracts
   remain unchanged.

Fresh verification for this review-fix round:

| Check | Result |
|---|---|
| Focused tests: sign-in-and-continue, auth-actions, auth-schemas, workout-start-panel, m19-navigation-integrity, not-found-page | **6 files / 90 tests passed** |
| `npm test` | **233 files / 3,154 tests passed** |
| `npx tsc --noEmit --incremental false` | exit 0 |
| `npm run lint` | exit 0 |
| `git diff --check` | exit 0 |

Integration tests were not rerun: production authentication behavior and shared
test infrastructure are unchanged. These are unit/jsdom redirect-call assertions
with mocked identity/use cases/cookie APIs, not browser or database-backed login
evidence. Build, HTTP and browser probes were not rerun; the earlier evidence
and remaining limitations above retain their original scope.
