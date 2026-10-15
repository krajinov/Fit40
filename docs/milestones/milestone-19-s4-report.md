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

Six source files and two documentation files; no new dependency, no new
component, no new client state, no migration. (The P2/P3 review fixes in §11 add
`src/app/globals.css` for the shared slot token and two further test files.)

| File | Change | Why |
|---|---|---|
| `src/components/shared/MobileTabBar.tsx` | Row padding `pt-2 pb-4` → `pt-[8px] pb-[16px]`; slot height from `--mobile-tab-bar-height` (see §11.2); each tab `min-w-0`; label span `max-w-full min-w-0 shrink-0 truncate`; icon `shrink-0` | D1, D2, §11.2. The `md:hidden`, `pb-[env(safe-area-inset-bottom)]`, four slots, `aria-label="Primary"`, `aria-current`, 22px icons and `/session` hide are unchanged. |
| `src/components/shared/AppNavLinks.tsx` | `mobileHeader` variant: wrapping nav, `min-h-11 shrink-0` links with full labels, compact padding (§11.1); the `desktop` variant is untouched | D3, §11.1. |
| `src/components/shared/MobileHeader.tsx` | Wrapping row (`min-h-16 flex-wrap`, §11.1); `Sign in` keeps its fixed 44px floor; account in an `ml-auto` group | D3, D4, §11.1. |
| `src/app/globals.css` | New `--mobile-tab-bar-height` token (`max(76px, calc(48px + 1.25rem))`) | §11.2 — one shared slot for the bar and the clearance. |
| `src/app/(app)/layout.tsx` | Clearance now `pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom))]` | §11.2 — the clearance and the bar can never drift. |
| `src/features/dashboard/components/RecentTrainingCard.tsx` | "View all training history" link gains `inline-flex min-h-[44px] items-center` | D5. The only mobile affordance for History becomes a real 44px target; the copy, href and desktop behaviour are unchanged. |
| `docs/ui.md` | MobileTabBar/MobileHeader rows, a new "Mobile navigation integrity (M19 S4)" bullet in the shell section, and the stale "Active Workout bottom bar" follow-up note corrected to the shipped behaviour | The documentation sweep S4 owns. |
| `tests/unit/architecture/mobile-navigation-integrity.test.ts` | S4 invariants (geometry, clearance, wrapping header, History, landmarks, S3 contracts) | See §4 and §11.3. |
| `tests/unit/architecture/mobile-bottom-bars.test.ts`, `tests/unit/helpers/fixed-bottom-scan.ts` | Bottom-bar scanner + per-state composition (§11.3) | P3. |
| `tests/unit/components/shared/mobile-tab-bar.test.ts` (+5), `tests/unit/components/shared/app-shell-headers.test.ts` (+4) | Component/runtime assertions for the slot, the label, the wrapping row and the nested routes | See §4 and §11.3. |

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

**Round 2 (§11.3)** replaced the literal-`className` scanner with
`tests/unit/helpers/fixed-bottom-scan.ts` + `tests/unit/architecture/mobile-bottom-bars.test.ts`
(scanner fixtures, repo-wide scan, per-state composition), replaced the tab bar's
`h-[76px]` assertions with the shared slot token, and added runtime composition
tests for the nested History detail route.


## 5. Before / after (measured in a real browser)

> **Superseded in part by §11.** The independent review found that two of the
> "after" cells below were not good enough: the compact header resolved crowding
> by ellipsizing its public labels (and at 200% text a label shrank to its
> padding only), and the tab bar's fixed 76px slot clipped the label's line box
> at 200% text. §11 records those findings, the fixes and the re-measured
> before/after numbers for every width and text size; the rows it overrides are
> marked **(→ §11)**.

| Check | Before | After |
|---|---|---|
| Mobile `Sign in` target height | 38.5px | **44px** |
| Signed-out header, 320px, 150% text **(→ §11)** | `Exercises` right edge 375.25 in a 320px viewport, colliding with `Sign in`; page **55px** too wide | Labels ellipsize (`P…`, `E…`), no collision, **0px** overflow, `Sign in` 44px |
| Signed-out header, 320px, 200% text **(→ §11)** | page **180px** too wide | **0px** overflow (labels ellipsize) |
| Tab slot height, default text | 52px | 52px (unchanged) |
| Tab slot height, 150% text | **40px** (below the 44px floor) | **52px** (54px after §11 — the slot grows to 78px) |
| Tab slot height, 200% text | **28px**, icon/label overflow the slot | **52px** (64px after §11 — the slot grows to 88px) |
| Dashboard 320px, 150% text | **8px** horizontal page scroll | **0px** (attribution test: hiding the bar keeps 0px, i.e. the bar contributes none) |
| Tab labels, 320px, 150% text **(→ §11)** | push the page sideways | ellipsize inside their slot; icons and `aria` names unchanged |
| History entry point (dashboard card) | 20px text link | **44px** target |
| Content clearance, tab bar (375px, long page) **(→ §11)** | 76px reserved vs 77px bar | unchanged: content box bottom 735.5 vs bar top 735 → **slack −0.5px** (the bar's own 1px top border) |
| Content clearance, tab bar (375px, +34px safe area) **(→ §11)** | 110px reserved vs 111px bar | unchanged: 701.5 vs 701 → **slack −0.5px** |
| Active session route (375px) | finish bar only, tab bar hidden | unchanged — one bar; measured bar top 735 / height 77 / `md:hidden`; mobile button 335×52 |
| Active session route (375px, +34px safe area) **(→ §11)** | — | bar bottom padding 46px (12 + 34), content box bottom 701.5 vs bar top 701 → **slack −0.5px** |
| Active session route (768px) | — | no mobile bars; inline "Finish workout" visible (172×52); `main` clearance 0 |
| `View all training history` → `/history` | link present | link present, exposed, 44px; a real click navigates to `/history` |
| Wordmark destination | signed out `/`, signed in `/dashboard` | unchanged in both headers, all widths |
| Primary landmark | one exposed `nav[aria-label="Primary"]` per breakpoint (the desktop one is `display:none` on mobile), one `<main>` | unchanged |
| Keyboard focus on tabs | — | `:focus-visible` true and a 3px accent ring painted on all four tabs during a real Tab walk (re-confirmed in §11) |

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
history detail route renders only the tab bar). **Round 2 added jsdom runtime
composition tests for both routes (§11.3); the screens themselves are still not
browser-verified.**

## 7. Verification results

> Round-1 numbers below; **§11.5** records the round-2 re-run on the review-fix
> commit.

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
- [x] Bottom-bar geometry: the locked 76px floor becomes the shared `--mobile-tab-bar-height` token, consumed by both the bar and the content clearance; the slot grows only when an enlarged base font needs it (76 / 78 / 88px) — see §11.2 for the contract review.
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

## 11. Round 2 — independent review fixes (P2 × 2, P3)

An independent review of `f437d030` raised three findings. All three are fixed in
this round; the sections above are the round-1 record, superseded where marked
**(→ §11)**.

### 11.1 P2 — the signed-out public labels disappeared (fixed)

**Root cause.** The compact mobile header was a single non-wrapping row whose nav
was `min-w-0 flex-1` with a truncating label. When the wordmark + both
destinations + the sign-in control exceeded the row, flexbox did not wrap — it
shrank the nav, and the truncating span collapsed until only the link padding
was left.

**Fix** (`MobileHeader.tsx`, `AppNavLinks.tsx`): the header is now a wrapping row
(`flex-wrap`, `min-h-16` instead of a fixed `h-16`) and the nav is itself a
wrapping row; the public links are `shrink-0` with their **full labels** and no
truncation. The wordmark keeps the first line and the account/sign-in control
sits in an `ml-auto` group, so it stays right-aligned on whichever line it lands
on; the destinations wrap as the space allows — at 320px/200% text the rows read
`Fit40` / `Programs · Sign in` / `Exercises`, and every label is fully readable.
`px-1` link padding plus a 6px row gap keep the default 320px row on ONE line,
exactly as before.

**Measured (real Chrome, production build, signed out, `/programs`):**

| Viewport / text | Before: label width, clipping | After: label width, clipping | Before | After |
|---|---|---|---|---|
| 320px / 100% | 75.94 / 74.86px, clipped | **73.33 / 72.22px, not clipped** | 64px, 1 row | **64px, 1 row** |
| 320px / 150% | **45.48 / 45.02px, clipped** | **110 / 108.33px, not clipped** | 96px, 3px page overflow | **203.5px (wrapped)**, 3px (page content) |
| 320px / 200% | **24px — padding only, text invisible; 1 collision** | **146.66 / 144.44px, not clipped; 0 collisions** | 128px, 68px page overflow | **265px (wrapped)**, 68px (page content) |
| 375px / 150% | 73.22 / 72.28px, clipped | **110 / 108.33px, not clipped** | 96px | 151px (wrapped) |
| 375px / 200% | 42.77 / 42.44px, clipped | **146.66 / 144.44px, not clipped** | 31px page overflow | 263.5px (wrapped) |
| 393px / 150% and / 200% | clipped at both | **not clipped at both** | — | 151px / 263.5px (wrapped) |
| 1440px (desktop) | 70 / 68.81px | **70 / 68.81px (untouched)** | 76px bar | 76px bar (unchanged) |

Touch targets across the matrix: 44px (100%), 66px (150%), 88px (200%) — the
`min-h-11` floor is never violated. The residual page overflow (3px at
320/150%; 68/31/21px at 200%) is **page content, not navigation**: it is
identical with the bar hidden, and its offenders are program-card text
(`3 workouts/week`) — the same conclusion as round 1.

### 11.2 P2 — the enlarged tab label was vertically clipped (fixed), and the 76px contract reviewed

**Root cause.** The icon (22px) and the label's line box scale with the base font
while the bar's paddings are fixed pixels, so at 200% root text the column
content (22 + 8 + 32 = 62px) exceeded the slot's 52px content box (76 − 8 − 16).
Because `truncate` sets `overflow: hidden`, the span's automatic minimum size is
zero, so flexbox *compressed the label* to 22px and clipped it — measured as
`labelClientH/labelScrollH = 22/32` at 320, 375 and 393px.

**Locked-contract review (required before changing bar dimensions).** Two
independent literals described one geometry: `h-[76px]` in `MobileTabBar` and
`pb-[calc(76px+env(safe-area-inset-bottom))]` in `(app)/layout.tsx`, pinned by an
S3 guard. Fitting the label inside a locked 76px slot is impossible at 200%
text, and growing only the bar would have let it cover content. The conflict is
therefore resolved by making the slot ONE shared token whose locked 76px is a
**floor**:

```css
--mobile-tab-bar-height: max(76px, calc(48px + 1.25rem)); /* 76 / 78 / 88px */
```

* `MobileTabBar` uses `min-h-[var(--mobile-tab-bar-height)]` — never below 76px,
  identical at every text size in the reviewed default.
* `(app)/layout.tsx` reserves
  `pb-[calc(var(--mobile-tab-bar-height)+env(safe-area-inset-bottom))]` — the
  **same** token, so the reserved space and the rendered bar can never disagree
  (previously two copies of `76px` that could drift apart).
* The S3 guard was updated from the literal to the invariant: the layout uses the
  token + inset, no hard-coded `76px` survives in the layout, and the bar
  consumes the same token.
* The label is additionally `shrink-0`, so flex compression can never clip it
  again regardless of the slot formula.

history detail route renders only the tab bar).

**Measured (real Chrome, production build, signed in, `/dashboard`, and the
active workout route):**

| Viewport / text | Slot (row) | Bar | Clearance | Label box `client/scroll` | Clipped before? | Bar-attributable overflow |
|---|---|---|---|---|---|---|
| 320px / 100% | 76px | 77px | 76px (slack −0.5) | 16/16 | no | none — 0px with and without the bar |
| 320px / 150% | **78px** | 79px | **78px** (slack −1) | 24/24 | no | none — the 3px present is page content (identical without the bar) |
| 320px / 200% | **88px** | 89px | **88px** (slack −1) | **32/32** | **yes (22/32)** | none — 68px page content |
| 375px / 150% | 78px | 79px | 78px | 24/24 | no | none |
| 375px / 200% | **88px** | 89px | **88px** | **32/32** | **yes (22/32)** | none — 31px page content |
| 393px / 200% | 88px | 89px | 88px | **32/32** | **yes (22/32)** | none — 21px page content |
| 375px / 100% + 34px inset | 76px | 111px (76+1+34) | 110px (76+34) | 16/16 | no | none |
| 375px / 150% + 34px inset | 78px | 113px | 112px | 24/24 | no | none |

Touch targets: 52px (100%), 54px (150%), 64px (200%) — all ≥44px. All four tabs
remain present and in order, with correct `aria-current` on `/dashboard`,
`/programs`, `/exercises` and `/progress`, and no active tab on `/history`.
Keyboard: a real Tab walk reaches all four tabs with `:focus-visible = true` and a
painted 3px accent ring on each. Active workout route: exactly one bottom bar at
320/375/393/1440px (the finish bar), never the tab bar.

**Programs vs Progress distinction.** At 393px/150% and wider neither label
ellipsizes. At 320px/150–200%, 375px/200% and 393px/200% both ellipsize to the
same prefix, so the distinction is carried by the always-visible 22px icons —
measured as different SVG path data (`M17.596 12.768…`, dumbbell, vs
`M16 7h6v6`, trend line) — plus the active tab's accent colour/weight and the
full label in the DOM (so the accessible name is never truncated).

### 11.3 P3 — incomplete bottom-bar coverage (fixed)

* The literal-`className` scanner was replaced by
  `tests/unit/helpers/fixed-bottom-scan.ts`: it tokenizes double-quoted,
  single-quoted and template literals, unions the literals inside a
  `className`/`cn(`/`clsx(`/`cva(` window, requires the exact tokens `fixed`
  **and** `bottom-0` (so `padding-bottom-0` never matches), ignores
  `absolute`/`sticky` positioning, and strips comments first. Its own regression
  tests cover each form plus the negatives.
* New `tests/unit/architecture/mobile-bottom-bars.test.ts` adds the repo-wide
  scan (exactly the tab bar and the finish bar and nothing else), the
  finish-bar-composer check, and composition assertions for the three screen
  states: **active session** (composes the finish bar; the tab bar hides on
  `/session`), **completed session** (`SessionCompletedPanel` composes no bar of
  its own → zero bars on that screen) and **History detail** (nothing under
  `features/history` renders a bar → the tab bar is the only one).
* Runtime composition (jsdom) was added to `mobile-tab-bar.test.ts`: the bar
  renders four tabs on the nested `/history/sessions/<id>` route with no tab
  active, and stays absent on the `/session` route.

**Source-level vs runtime vs browser.** The scanner and composition assertions
are *source-level* guarantees; the jsdom tests are *runtime* guarantees for the
component's own render; the geometry, clipping, overflow, safe-area, focus and
active-state numbers in §11.1/§11.2 are *browser*-measured. Nothing in this slice
claims browser verification it did not perform — in particular the completed
session screen and the History detail screen were not opened in a browser (see
§11.4).

### 11.4 Remaining limitations and unresolved risks

1. **Enlarged text on the narrowest screens still ellipsizes tab labels** and
   makes the compact header take a second/third row. That is the physical limit
   of four slots at 320px with 150–200% text: nothing is clipped, navigation adds
   no page overflow, and the icons carry the Programs/Progress distinction.
   Flagged for product sign-off (unchanged conclusion from round 1).
2. **Desktop nav overflow is pre-existing and outside this review's scope.** The
   locked desktop row (5 destinations, no wrapping) overflows at 768px with
   enlarged text: **107px at 150%** and **268px at 200%** signed in (6px signed
   out at 200%, 2 links); at 1440px it is 0. Fixing it means letting the desktop
   nav wrap or reducing its type scale — a desktop-header design decision that a
   mobile-focused slice must not make unilaterally.
3. **Finish-bar clearance on session routes at 150% text** exceeds the reserved
   slot by 4.75px (7px before this round; 0.75px at 200% vs 13px before). The
   finish bar is an M11 surface whose rem-scaled padding differs from the shell
   slot formula; the overlap stays within the bar's own border band plus empty
   content padding, so no readable content is covered — reported, not silently
   re-tuned.
4. **Beyond 200% base text is unverified.** Both the slot and the content scale
   with `rem` so they should keep tracking, but only 100/150/200% were measured.
5. **Completed-session and History-detail screens were not opened in a browser**
   this round (the CDP harness still cannot complete a workout session through
   the Server Action); their bottom-bar composition is covered source-level and
   in jsdom (§11.3).
6. Not verified: real iOS/Android safe-area hardware (emulated with
   `Emulation.setSafeAreaInsetsOverride`), Safari/Firefox, real screen readers,
   pinch-zoom and RTL.

### 11.5 Verification results (round-2 commit)

| Check | Command | Result |
|---|---|---|
| Focused S4 tests (5 files) | `npx vitest run tests/unit/architecture/mobile-navigation-integrity.test.ts tests/unit/architecture/mobile-bottom-bars.test.ts tests/unit/architecture/auth-aware-navigation.test.ts tests/unit/components/shared/mobile-tab-bar.test.ts tests/unit/components/shared/app-shell-headers.test.ts` | **66 passed** |
| Focused S4 tests (7 files, + nav items / M18 progress guard) | same plus `nav-items.test.ts`, `training-progress.test.ts` | **85 passed** |
| Full unit suite | `npx vitest run` | **226 files / 3112 tests passed**, exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Production build | `npx next build --webpack` | exit 0 (webpack) |
| Whitespace | `git diff --check` | clean |
| Integration tests | — | not run: no Application, Domain or persistence change |
| Browser | Chrome 155 headless over CDP, production build on `:3161` | matrices in §11.1 / §11.2 |

One caveat on the sequencing, recorded for honesty: running `npx tsc --noEmit`
*concurrently* with `next build` produced spurious `TS6053` errors because the
build rewrites `.next/types/**`; the typecheck passes (exit 0) when run on its
own, which is the result recorded here.
