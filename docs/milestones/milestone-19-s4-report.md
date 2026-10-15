# Milestone 19 — Slice 4 Implementation Report

**Slice:** S4 — Mobile Navigation Integrity
**Branch:** `feat/m19-s4-mobile-navigation` (from `main` @ `e0471e80`, the merged S3 PR #26)
**Scope:** S4 only. No M8–M18 semantics, no database schema, no S5 exercise-history
integration and no S6 UX polish. The locked S1–S3 behaviours (error boundaries,
route placeholders, authentication-aware navigation) are preserved.

## 1. Objective

Section 9 of `milestone-19-plan.md`. The locked four-tab bar, the signed-out bar
hide and the `nav-items.ts` model already landed in **S3** (the plan records
this). S4 therefore covers the remaining integrity work: bottom-bar geometry,
safe-area insets, content clearance, horizontal overflow, duplicate bars on
nested (session) routes, enlarged-text behaviour, History discoverability
without a fifth tab, and the accessibility of every mobile navigation target —
plus the `docs/ui.md` sweep and the S4 regression tests.

## 2. Issues discovered

Every item below was reproduced in a real browser against the pre-change
production build (evidence in §5). `M19 S4-D*` identifiers are used in the test
names where relevant.

| # | Surface | Issue (verified before) |
|---|---|---|
| **D1** | Tab bar | The 76px slot is consumed by **rem-scaled** vertical padding (`pt-2 pb-4`). At 150% base text the four tabs are **40px** tall (below the 44px floor); at 200% they are **28px** and the 22px icon + label overflow the slot. |
| **D2** | Tab bar / page | At 320px with 150% text the four equal slots cannot fit `Home/Programs/Exercises/Progress`: the page gains **8px** of horizontal scroll (`scrollWidth 328 > 320`). |
| **D3** | Signed-out mobile header | At 150% text on 320px the public links collide with `Sign in` (Exercises right edge `375.25` in a 320px viewport) and the page scrolls sideways by **55px**; at 200% by **180px** (@320) / **125px** (@375). |
| **D4** | Mobile header | The `Sign in` control's tap target is **38.5px** tall at every width — below the ≥44px floor that `docs/ui.md` documents. |
| **D5** | Dashboard / History | The documented mobile entry point to History ("View all training history") is a **20px**-tall inline text link, i.e. not a real touch target. |
| **D6** | Session clearance | The finish bar paints **77px** (12 + 52 + 12 + 1px top border) against the shell's fixed **76px** clearance, so the bar's top border sits 0.5–1px over the end of the content box. Measured slack: **-0.5px** (sub-pixel rounding of the border). Reported, not "fixed": the clearance and the finish bar are locked S3/M11 contracts. |

### D7 — no duplicate bars (audit result, no defect)

The audit confirmed the preserved contract instead of a defect: `MobileTabBar`
returns `null` on `/session` (`pathname.endsWith('/session')`, locked) and
`SessionFinishBar` is the **only** other viewport-bottom bar in `src/` (a
source scan of every `className` containing `fixed` + `bottom-0` returns exactly
those two files). At `md`+ neither mobile bar renders and the session screen's
finish action sits inline. A regression guard now pins this.

### Method note

Two corrections to the verification harness were needed, and they matter for
reading §5:

- the route placeholder's live region is `sr-only`, so an `innerText`-based
  "is the view still loading?" probe never sees it — the harness now polls
  `[role="status"]` `textContent`;
- a long-lived headless Chrome instance stopped swapping React's streamed
  Suspense payloads (first paint only). All numbers below were re-taken in a
  fresh browser profile.


## 3. Implementation

Five source files and two documentation files; no new dependency, no new
component, no new client state, no migration.

| File | Change | Why |
|---|---|---|
| `src/components/shared/MobileTabBar.tsx` | Row padding `pt-2 pb-4` → `pt-[8px] pb-[16px]`; each tab `min-w-0`; label span `max-w-full min-w-0 truncate`; icon `shrink-0` | D1, D2. The 76px slot, `md:hidden`, `pb-[env(safe-area-inset-bottom)]`, the four slots, `aria-label="Primary"`, `aria-current`, the 22px icons and the `/session` hide are all unchanged. The padding becomes a fixed pixel value (identical at the default font size: 8px/16px) so a larger user base font cannot eat the slot; the label still scales with the user's font size. |
| `src/components/shared/AppNavLinks.tsx` | `mobileHeader` variant only: link `px-2` → `px-1.5` plus `min-w-0`, label wrapped in a truncating `<span>`; the `desktop` variant renders exactly as before (plain text node, `text-[15px]`) | D3. The compact signed-out row may compress and ellipsize but can no longer collide with `Sign in` or widen the page. |
| `src/components/shared/MobileHeader.tsx` | Row `gap-3` → `gap-2`; `Sign in` gains `inline-flex min-h-[44px] items-center px-1` | D3 (room for the public row at 320px) and D4 (44px floor, matching `docs/ui.md`). |
| `src/features/dashboard/components/RecentTrainingCard.tsx` | "View all training history" link gains `inline-flex min-h-[44px] items-center` | D5. The only mobile affordance for History becomes a real 44px target; the copy, href and desktop behaviour are unchanged. |
| `docs/ui.md` | MobileTabBar row, a new "Mobile navigation integrity (M19 S4)" bullet in the shell section, and the stale "Active Workout bottom bar" follow-up note corrected to the shipped behaviour | The documentation sweep S4 owns. |
| `tests/unit/architecture/mobile-navigation-integrity.test.ts` (new, 15 tests) | See §4 | Regression guards for every S4 invariant. |
| `tests/unit/components/shared/mobile-tab-bar.test.ts` (+3), `tests/unit/components/shared/app-shell-headers.test.ts` (+3) | See §4 | Component-level assertions for the new geometry and the compact row. |

**Explicitly not changed** (locked contracts preserved and asserted by tests):
`MobileTabBar`'s `pathname.endsWith('/session')` early return, the 76px height,
the safe-area padding, `(app)/layout.tsx`'s
`pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0` clearance, the four-tab
set and its order, `nav-items.ts`, `SessionFinishBar`, the desktop header and
desktop History navigation, and the S3 authentication/wordmark behaviour.

## 4. Tests added

`tests/unit/architecture/mobile-navigation-integrity.test.ts` (new):

1. geometry/clearance — 76px slot, safe-area padding, `md:hidden`, px-locked
   padding (plus a guard against re-introducing `pt-2`/`pb-4` on the row), layout
   clearance equal to slot + inset, `min-w-0` + truncate;
2. one bar per route family — the `/session` hide, and a source scan proving
   `MobileTabBar` + `SessionFinishBar` are the only two `fixed`/`bottom-0`
   surfaces in `src`;
3. History discoverability — the mobile tab set stays exactly four, `/history`
   stays a desktop destination, the dashboard composes `RecentTrainingCard`, and
   that card's link is a 44px target;
4. landmarks/active state/floor — `aria-label="Primary"`, `aria-current`,
   `aria-hidden` icons, focus-ring classes, no feature import or second auth
   state in the shell, and the 44px floor on every mobile navigation target;
5. preserved S3 contracts — auth-aware wordmark destinations, the `/login`
   target, `visibleNavItems(isAuthenticated)`, and "no header nav when signed in".

`mobile-tab-bar.test.ts` (+3): fixed-pixel padding with `items-stretch` and four
slots; `min-w-0`/`truncate` on every slot with the full label kept in the DOM;
top border + safe-area padding + `bottom-0` on the bar surface.

`app-shell-headers.test.ts` (+3): the `Sign in` 44px floor; the compact public
links' `min-h-11`/`min-w-0`/truncate with full labels; and that the desktop row
stays unwrapped and unchanged.

Deliberately **not** asserted: RTL/`dir`, dark mode, and the rendered width of a
truncated label (font-dependent).


## 5. Before / after (measured in a real browser)

| Check | Before | After |
|---|---|---|
| Mobile `Sign in` target height | 38.5px | **44px** |
| Signed-out header, 320px, 150% text | `Exercises` right edge 375.25 in a 320px viewport, colliding with `Sign in`; page **55px** too wide | Labels ellipsize (`P…`, `E…`), no collision, **0px** overflow, `Sign in` 44px |
| Signed-out header, 320px, 200% text | page **180px** too wide | **0px** overflow (labels ellipsize) |
| Tab slot height, default text | 52px | 52px (unchanged) |
| Tab slot height, 150% text | **40px** (below the 44px floor) | **52px** |
| Tab slot height, 200% text | **28px**, icon/label overflow the slot | **52px** |
| Dashboard 320px, 150% text | **8px** horizontal page scroll | **0px** (attribution test: hiding the bar keeps 0px, i.e. the bar contributes none) |
| Tab labels, 320px, 150% text | push the page sideways | ellipsize inside their slot; icons and `aria` names unchanged |
| History entry point (dashboard card) | 20px text link | **44px** target |
| Content clearance, tab bar (375px, long page) | 76px reserved vs 77px bar | unchanged: content box bottom 735.5 vs bar top 735 → **slack −0.5px** (the bar's own 1px top border) |
| Content clearance, tab bar (375px, +34px safe area) | 110px reserved vs 111px bar | unchanged: 701.5 vs 701 → **slack −0.5px** |
| Active session route (375px) | finish bar only, tab bar hidden | unchanged — one bar; measured bar top 735 / height 77 / `md:hidden`; mobile button 335×52 |
| Active session route (375px, +34px safe area) | — | bar bottom padding 46px (12 + 34), content box bottom 701.5 vs bar top 701 → **slack −0.5px** |
| Active session route (768px) | — | no mobile bars; inline "Finish workout" visible (172×52); `main` clearance 0 |
| `View all training history` → `/history` | link present | link present, exposed, 44px; a real click navigates to `/history` |
| Wordmark destination | signed out `/`, signed in `/dashboard` | unchanged in both headers, all widths |
| Primary landmark | one exposed `nav[aria-label="Primary"]` per breakpoint (the desktop one is `display:none` on mobile), one `<main>` | unchanged |
| Keyboard focus on tabs | — | `:focus-visible` true and a 3px accent ring painted on all four tabs during a real Tab walk |

## 6. Browser verification matrix

Real Chrome (headless, CDP), production build (`next build --webpack` +
`next start`), fresh browser profile. "Signed in" used a throwaway local
account (`s4mobile+…@example.com`) with a locally inserted profile row; the
account and the one started workout session exist only in the developer's local
database.

| Width / text | Signed out (`/programs`) | Signed in (`/dashboard`, `/programs`, `/exercises`, `/progress`, `/history`) | Session route |
|---|---|---|---|
| 320 (default) | header = wordmark + Programs + Exercises + `Sign in` (44px), no bar, 0 overflow ✔ | 4 tabs (70px wide, 52px tall), correct `aria-current`, 0 overflow ✔ | active: finish bar only ✔ |
| 375 (default) | as above, 0 overflow ✔ | 4 tabs (83.75px, 52px), 0 overflow ✔ | active: 1 bar, clearance −0.5px ✔ |
| 393 (default) | 0 overflow ✔ | 4 tabs (88.25px, 52px) ✔ | — |
| 768 | desktop header, no tab bar, 0 overflow ✔ | desktop nav (5 destinations incl. History), no tab bar, clearance 0 ✔ | no mobile bars, inline finish action ✔ |
| 1440 | desktop header (`Programs`, `Exercises`, `Sign in`), 0 overflow ✔ | desktop nav 5 destinations, no tab bar ✔ | — |
| 375 + 34px safe area | no bar ✔ | bar padding-bottom 34px, clearance 110px, slack −0.5px ✔ | finish bar 12+34px padding, slack −0.5px ✔ |
| 320/375 @125% text | 0 overflow ✔ | tab slots 52px ✔ | — |
| 320/375 @150% text | 320 → 3px residual overflow, **page content** (program-card stat); header itself 0 ✔ · 375 → 0 ✔ | 375 → 0 overflow, tab slots 52px ✔ · 320 → tab slots 52px, 0 bar-attributable overflow ✔ | — |
| 320/375 @200% text | 320 → 68px residual overflow, **page content**; header 0 ✔ · 375 → 31px, page content ✔ | 375 → 0 overflow, tab slots 52px ✔ | — |

**Browser-verified:** tab set/order/labels, per-route active state, tab-bar
presence rules (hidden signed out, hidden on `/session`, hidden at `md`+),
tab geometry at every width and text size, safe-area padding and clearance, the
44px floors, a single `Primary` landmark and a single `<main>`, keyboard focus
ring, the wordmark destinations, the dashboard History link (real click →
`/history`), and the session screen's single bottom bar with an inline desktop
finish action.

**Unit-test-only (not browser-verified):** `aria-current="page"` on *every*
route (browser-checked on `/dashboard`, `/programs`, `/exercises`, `/progress`
and `/history`, asserted for all in jsdom), the rendered width of truncated
labels, and the source-scan invariant "only two viewport-bottom bars exist".

**Not achieved in the browser:** the *completed* session screen and the
`/history/sessions/[id]` detail route. The `Finish workout` Server Action
submitted (a `submit` event was observed and there was no console error) but
produced no state change in the local database through the CDP harness, so no
completed session existed for the test account; both states are covered by the
source-level guard instead (the completed panel renders no bottom bar; the

## 7. Verification results

| Check | Command | Result |
|---|---|---|
| Focused S4 tests | `npx vitest run tests/unit/architecture/mobile-navigation-integrity.test.ts tests/unit/components/shared/mobile-tab-bar.test.ts tests/unit/components/shared/app-shell-headers.test.ts tests/unit/components/shared/nav-items.test.ts tests/unit/architecture/auth-aware-navigation.test.ts tests/unit/architecture/training-progress.test.ts` | **70 passed** (6 files) |
| Full unit suite | `npx vitest run` | **225 files / 3097 tests passed**, exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Production build | `npx next build --webpack` | succeeded (webpack; Turbopack not used) |
| Whitespace | `git diff --check` | clean |
| Browser | Chrome 155 headless over CDP, production server on `:3161` | matrix in §6 |

Integration tests (`pnpm test:integration`) were not run: S4 changes no
Application, Domain or persistence code.

## 8. Remaining limitations

1. **Enlarged text on the narrowest screens compresses labels.** At 320px with
   a 150% base font the signed-out header ellipsizes `Programs`/`Exercises`
   (`P…`/`E…`) and the tab bar can render `Progr…` for both `Programs` and
   `Progress` (the icons and the `aria` names still disambiguate). This is the
   physical limit of a single row at that combination — flagged for **product
   sign-off** per plan D3, whose fallback ("rely on page-content catalog links")
   was not needed because the labels stay reachable and no page scroll appears.
2. **Page-content overflow at ≥150% text on 320px is out of scope.** The
   residual overflow measured at 320px/150% (3px, `/programs` card stat) and at
   320–375px/200% (31–68px, dashboard header buttons and `3 × 8–10` meta spans)
   comes from page content, not navigation: hiding the tab bar leaves the same
   number, and the dashboard at 320px/150% now has **0px**. General reflow at
   ≥200% text belongs to M19 S6 / general UX work.
3. **The bar's 1px top border overlaps the reserved clearance** (slack −0.5px
   after rounding). The clearance and the finish bar are locked S3/M11
   contracts, so this is reported rather than changed; no readable content is
   covered.
4. **No navigation landmark on the session route at mobile widths.** The tab bar
   hides there by contract and the screen's own action bar is an action, not a
   landmark; the banner (wordmark) and the in-page "← Workout details" link on
   the non-active panels provide the exits.
5. **Not verified in a browser:** iOS/Android safe-area hardware (emulated via
   `Emulation.setSafeAreaInsetsOverride`), Safari/Firefox, real screen-reader
   output, pinch-zoom, and the two route/state combinations listed at the end of
   §6.
6. The local dev database gained one throwaway account
   (`s4mobile+1792081296473@example.com`), one profile row and one in-progress
   workout session for it. Nothing in the repository or its tests depends on
   them.

## 9. Acceptance criteria

- [x] Authenticated tabs `Home`, `Programs`, `Exercises`, `Progress`, in order, exactly four.
- [x] No Profile tab; Profile stays reachable through the account menu (unchanged).
- [x] Signed out: tab bar hidden (S3), public hrefs in the header, `Sign in` present.
- [x] Active tab correct per route, including nested routes; signed-out active states identical.
- [x] Session routes: exactly one viewport-bottom bar (active → finish bar; other states → none), never both, never a third (guarded).
- [x] Safe-area padding and the 76px slot/clearance geometry unchanged (`slack −0.5px`).
- [x] No navigation-attributable horizontal scrolling at 320/375/393/768/1440.
- [x] Touch targets ≥44px on mobile navigation surfaces (tabs 52px, header links ≥44px, `Sign in` 44px, account control 44px, History entry 44px).
- [x] History discoverable and reachable without a fifth tab (desktop nav + dashboard card, real click verified); desktop History navigation unchanged.
- [x] Wordmark destination preserved: signed out `/`, signed in `/dashboard`.
- [x] `aria-label="Primary"`, `aria-current`, `aria-hidden` icons, visible keyboard focus, one `<main>`.
- [x] S1/S2 error and loading behaviour untouched; S3 navigation contracts preserved.
- [x] No M8–M18 business logic, database schema, migration or new dependency; S5/S6 not started.
- [x] S4 regression tests added and green; full suite, typecheck, lint, `next build --webpack` and `git diff --check` clean.

## 10. Commit

See the commit hash in the final response. Not pushed; no PR opened; S5 not
started. Reviewed files: the five source files in §3, `docs/ui.md`, the three
test files in §4 and this report.

history detail route renders only the tab bar).
