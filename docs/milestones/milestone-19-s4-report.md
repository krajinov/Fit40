# Verification status after P1 review

The current approach is documented in §15 and
[the manual browser checklist](../mobile-navigation-verification.md). §§1–13
are historical evidence from earlier commits; their CDP commands, harness
design rationale and transport limitations are superseded. The custom runner
and its support infrastructure have been removed. The class/source-format
guards described in earlier sections have also been removed; §15 records their
behavioral replacements and the remaining architectural exceptions.

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
| `src/components/shared/AppNavLinks.tsx` | `mobileHeader` variant: wrapping nav, `min-h-11 shrink-0` links with full labels, compact padding (§11.1); the `desktop` variant is untouched. Round 3 additionally drops `flex-1` from that variant (§12.1). | D3, §11.1, §12.1. |
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

**Round 3 (§12)** was pushed to the existing branch `feat/m19-s4-mobile-navigation`
(same PR [#27](https://github.com/krajinov/Fit40/pull/27)); it touches
`src/components/shared/AppNavLinks.tsx`, `src/components/shared/MobileHeader.tsx`,
`package.json` (the new `test:e2e` script, no new dependency), two unit test
files, the new `tests/e2e/` browser test, `docs/ui.md` and this report. Still no
merge and no S5.

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
(→ **§12.1**: that row *order* put `Sign in` ahead of `Exercises` against the
keyboard order and is superseded by the round-3 fix; the label widths measured
here are unaffected.)
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
   (→ **§12.4**: the round-3 order fix makes the compact header take two to four
   rows; the tab-bar label ellipsis at 200% is unchanged.)
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

### 11.5 Verification results (round-2 commit; round 3 is §12.3)

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

## 12. Round 3 — Codex review fix (P2, PR #27)

An automated review of `9982a50d` (GitHub Codex, PR #27) raised one further P2
finding about the round-2 fix. It is fixed in this round. §11.1's account of the
wrapped row is superseded where it describes the *order* of the wrapped rows.

### 12.1 P2 — the rendered order contradicted the keyboard order (fixed)

**Finding (`src/components/shared/MobileHeader.tsx:39`).** At 320px with 200%
base text the visual order became `Fit40 / Programs · Sign in / Exercises` while
the DOM and the keyboard order stayed `Fit40 → Programs → Exercises → Sign in`,
so the tab sequence did not follow what the user sees.

**Reproduced in a real browser** (production build, signed out, `/programs`,
real Chrome, real `Tab` presses via `Input.dispatchKeyEvent`; the reading order
is derived from measured boxes — lines are items whose vertical centres are
within 4px, ordered left to right):

| Viewport / text | Keyboard order (Tab) | Measured visual order | Verdict |
|---|---|---|---|
| 320px / 200% | `/ → /programs → /exercises → /login` | `/ → /programs → /login → /exercises` | **mismatch** |
| 320px / 150% | `/ → /programs → /exercises → /login` | `/programs → / → /exercises → /login` | **mismatch** |
| 375px / 150% | idem | `/programs → / → /login → /exercises` | **mismatch** |
| 375px / 200% | idem | `/programs → / → /exercises → /login` | **mismatch** |
| 393px / 150% | idem | `/programs → / → /login → /exercises` | **mismatch** |
| 393px / 200% | idem | `/programs → / → /exercises → /login` | **mismatch** |
| 320 / 375 / 393px @ 100% | idem | idem | consistent (one 64px row) |

At 320px/200% the raw geometry names the cause: the nav occupied
`40,72 → 163.42×184` (two of its *own* lines) between the wordmark (`40,8`) and
the account group (`215.42,136.75`), so `Exercises` (centre y 212) rendered below
`Sign in` (centre y 164) even though the tab order reaches `Exercises` first.

**Root cause.** The compact nav carried `flex-1`, so its flex basis was zero and
the header's line breaking always placed the whole nav on the first line beside
the wordmark and the account control; the nav then wrapped *its own* links into a
narrow column. Round 2 fixed a **shrinking** nav; a **growing** one produced this
finding. The nav must simply not take part in flex sizing.

**Fix** (`AppNavLinks.tsx`, one class): the `mobileHeader` variant drops `flex-1`
and becomes `flex flex-wrap items-center gap-1`. The nav keeps its natural width,
so the HEADER's flex lines — not the nav's — decide where a row ends and the nav
lands on a row that precedes the account row. No `order` utility, no `tabindex`,
no DOM reshuffle: the normal DOM order is the only order there is.

**Re-measured after the fix (same harness):**

| Viewport / text | Rows | Header height | Order (visual = keyboard = DOM) | Header overflow | Label width (Programs / Exercises / Sign in) |
|---|---|---|---|---|---|
| 320 / 100% | 1 | 64px | Fit40 → Programs → Exercises → Sign in | 0 | 73 / 72 / 57px, no clipping |
| 320 / 150% | 3 | 180px | idem | 0 | 110 / 108 / 61px, no clipping |
| 320 / 200% | 4 | 328px | idem | 0 | 147 / 144 / 65px, no clipping |
| 375 / 100% | 1 | 64px | idem | 0 | as above |
| 375 / 150% | 2 | 132px | idem | 0 | as above |
| 375 / 200% | 4 | 328px | idem | 0 | as above |
| 393 / 100% | 1 | 64px | idem | 0 | as above |
| 393 / 150% | 2 | 132px | idem | 0 | as above |
| 393 / 200% | 3 | 232px | idem | 0 | as above |

Every destination keeps its full label (measured `scrollWidth == clientWidth`),
every keyboard-focused destination reports `:focus-visible` with its 3px ring,
the nav/Sign-in touch targets are ≥44px (44/66/88px at 100/150/200%), and the
header contributes **zero** horizontal overflow at every combination
(`header.scrollWidth == header.clientWidth`, and no item's right edge passes the
viewport edge). At 100% text the header is still exactly one 64px row.

**The cost, stated plainly:** at 200% text the header is taller than in round 2
(328px vs 265px at 320px) because the whole nav now takes its own rows instead of
being squeezed into a column beside the sign-in control. That trade is the point
of the fix — fully readable labels in a truthful order rather than a shorter but
misleading layout.

### 12.2 Regression tests

- `tests/e2e/mobile-header-focus-order.mjs` (new; run by `npm run test:e2e`):
  renders the production build in real Chrome, walks the header with real Tab
  presses and compares the resulting focus order against the *measured* visual
  reading order at 320/375/393px × 100/150/200% text, plus label integrity, the
  44px floor, the focus ring, header overflow and the single 64px row.
  **Verified to fail on the pre-fix code:** with `flex-1` restored and rebuilt it
  reports **12 failures across 6 of the 9 combinations** and exits 1, including
  `320px @ 200% · measured visual order — expected / → /programs → /exercises → /login, measured / → /programs → /login → /exercises`.
- `tests/unit/components/shared/app-shell-headers.test.ts` (+2): the compact nav
  must not grow or shrink (`flex-1`, `flex-auto`, `grow`), and the header's
  rendered focusable order is `/, /programs, /exercises, /login` with no `order-*`
  utility and no `tabindex` anywhere in the header.
- `tests/unit/architecture/mobile-navigation-integrity.test.ts`: the round-2
  guard that asserted the literal `flex flex-1 flex-wrap items-center gap-1`
  string is updated to assert the class string *without* `flex-1`/`min-w-0`, and
  now records why both a shrinking and a growing nav are wrong.

The E2E layer is dependency-free **by design**: `docs/testing.md` names Playwright,
but neither Playwright nor its browsers are dependencies of this repository and
`AGENTS.md` forbids adding a library without explicit approval. The harness drives
the already-installed Chrome over the DevTools protocol using Node built-ins only
— the same technique the S4 browser evidence used — and `npm run test:e2e` boots
`next start` itself (`E2E_BASE_URL` and `CHROME_PATH` override the defaults).

### 12.3 Verification results (round-3 commit)

| Check | Command | Result |
|---|---|---|
| Browser regression test | `npm run test:e2e` | **exit 0**, 9/9 combinations |
| Same test against the pre-fix code | temporary `flex-1` restore + rebuild | **exit 1**, 12 failures |
| Focused S4 tests (7 files) | `npx vitest run` on the §11.5 file set | **87 passed** |
| Full unit suite | `npx vitest run` | **226 files / 3114 tests passed**, exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Production build | `npx next build --webpack` | exit 0 |
| Whitespace | `git diff --check` | clean |
| Integration tests | — | not run: no Application, Domain or persistence change |

### 12.4 Round-3 limitations

1. **The four-row header at 320px/200% text is tall** (328px). It is the physical
   limit of a wordmark plus two destinations plus a sign-in control at 320px with
   doubled text, and it is now taller than round 2's squeezed layout. Order,
   labels, touch targets and overflow are all correct; only vertical space grew.
   Flagged for product sign-off together with §11.4 item 1.
2. **The pre-existing page-content overflow is untouched** (3px at 320/150%;
   68/30/21px at 200%): the measured offenders are program-card text
   (`3 workouts/week`), not navigation. Reproduced identically before and after
   this fix.
3. **The wordmark's own tap target is 28px tall at 100% text** (pre-existing; it is
   inline link text, not a control). Round 3 preserves it rather than changing an
   S3-locked surface; the nav links and `Sign in` are ≥44px.
4. Beyond-200% text, real iOS/Android safe areas, Safari/Firefox, real screen
   readers, pinch-zoom and RTL remain unverified, as in §11.4 items 4–6.
   (→ **§13**: the round-4 fix makes the E2E harness runnable on Node 20.9.0, so
   these round-3 measurements can now be reproduced on the minimum runtime.)

## 13. Round 4 — Codex review fix (P2, PR #27): the E2E harness on Node 20.9

A further automated review of `39ed0b0` (GitHub Codex, PR #27) raised one more P2
finding, this time against the *verification harness* rather than the page:

> `tests/e2e/support/cdp.mjs:14` — The CDP E2E harness relies on the global
> WebSocket API, which is unavailable by default on some Node.js 20 versions
> supported by Next.js 16.

### 13.1 The finding is real, and it killed the whole E2E layer on a supported runtime

`package.json` pins `next@16.3.1`, whose own manifest declares
`engines: { node: ">=20.9.0" }` — so **Node 20.9.0 is a supported runtime**. The
WHATWG `WebSocket` global is not part of it (Node.js globals documentation,
"Class: WebSocket"):

| Node.js | `typeof globalThis.WebSocket` |
|---|---|
| 20.9.0 | `undefined` — even the `--experimental-websocket` flag only landed in 20.10.0 |
| 20.10.0 – 21.x | `undefined` unless `--experimental-websocket` is passed |
| 22.0.0+ | `function` (on by default; marked stable in 22.4.0) |

`cdp.mjs` did `const socket = new WebSocket(webSocketUrl);`, so on Node 20.9.0
every `npm run test:e2e` run died before it could connect. Reproduced on a real
Node 20.9.0 binary with the pre-fix file restored:

```
$ git show 39ed0b0:tests/e2e/support/cdp.mjs > tests/e2e/support/cdp.mjs
$ node --version; node -e "console.log(typeof WebSocket)"
v20.9.0
undefined
$ npm run test:e2e
ReferenceError: WebSocket is not defined
    at connect (file:///workspace/tests/e2e/support/cdp.mjs:14:18)
    at openPage (file:///workspace/tests/e2e/support/browser.mjs:148:24)
exit=1
```

The stack frame is `cdp.mjs:14:18` — exactly the line the finding names. This was
not a degradation: on the minimum supported version the S4 browser evidence
(§12.2, §12.3) could not be produced at all.

### 13.2 The fix: one compatibility boundary, no new dependency

`AGENTS.md` forbids adding a library without explicit approval, and the
repository has no WebSocket dependency (`ws`, `undici`, `isomorphic-ws` are all
absent from `package.json` and the lockfile). The fix is therefore a small,
explicit compatibility layer written on Node built-ins, plus a single boundary
that every socket goes through.

| File | Change | Why |
|---|---|---|
| `tests/e2e/support/websocket-frames.mjs` | **new** — RFC 6455 codec: masked client frames, unmasked server frames, fragmentation, ping/pong/close, incremental parsing | the byte layer, unit-testable on its own (`node:crypto` only) |
| `tests/e2e/support/minimal-websocket.mjs` | **new** — WHATWG-shaped client over `node:http` + `node:crypto` | the fallback used when the runtime has no global |
| `tests/e2e/support/websocket.mjs` | **new** — transport selection, `hasNativeWebSocket()`, `resolveWebsocketTransport()`, `assertWebsocketTransport()`, `openWebSocket()` | the one place that knows whether a global exists |
| `tests/e2e/support/cdp.mjs` | `new WebSocket(url)` → `openWebSocket(url)` | the finding; line 14 no longer touches the global |
| `tests/e2e/mobile-header-focus-order.mjs` | runs the explicit runtime check and prints `transport … · Node …` | makes a future regression visible in the run output |

Behaviour-preserving choices, stated explicitly:

- **The platform global still wins.** On Node ≥ 22 (and in browsers/Deno/Bun)
  `openWebSocket()` returns `new globalThis.WebSocket(url)`, i.e. byte-for-byte
  the previous behaviour; the fallback is only reached where the old code threw.
- **No CDP semantics changed.** The client still drives `Runtime.evaluate`,
  `Input.dispatchKeyEvent`, `Emulation.setDeviceMetricsOverride` and
  `Page.navigate`; the harness's arguments, matrix, assertions and printed
  format are untouched apart from one added informational line.
- **The fallback dispatches events from microtasks**, like the WHATWG
  implementation, so a `message` listener registered in the `open` handler still
  sees frames that arrived in the same packet as the handshake response.
- **The fallback is `ws://` only.** Chrome's DevTools endpoint is always
  `ws://127.0.0.1:<port>/devtools/…`, so this is unreachable in practice;
  `wss://` raises a labelled error rather than failing obscurely.

### 13.3 Regression coverage so this cannot silently return

Three layers, all added in this round:

- `tests/unit/e2e/websocket-transport.test.ts` — **functional.** With
  `globalThis.WebSocket` stubbed away (the exact Node 20.9 situation) the
  fallback completes a real handshake and round trip against an independent
  echo server: masked client frames, a fragmented server message, a ping the
  client must answer with a pong, and the CDP-shaped request echoed back. The
  same round trip is then repeated through the platform global, so the two
  transports cannot drift apart. Plus the explicit-runtime-check behaviour,
  including the labelled failure for a runtime that offers an unusable
  WebSocket.
- `tests/unit/helpers/websocket-echo-server.ts` — **new**, a hand-rolled RFC 6455
  server written independently of the client (it writes unmasked frames and
  decodes masked ones), so a client that stopped masking payloads, mishandled
  fragmentation or ignored pings fails against it rather than passing against
  its own bug.
- `tests/unit/e2e/websocket-compat-guards.test.ts` — **source-level.** `cdp.mjs`
  must not contain `new WebSocket(`, must not reference `globalThis.WebSocket`,
  and must go through `openWebSocket`; `websocket.mjs` may only reach for the
  global behind `typeof globalThis.WebSocket === 'function'`; the runner must
  keep its runtime check and printed transport label; no `ws`/`websocket`/
  `isomorphic-ws`/`undici` dependency may be added; and the Next.js `engines.node`
  floor that makes all of this necessary is pinned at `>=20.9.0`. The file also
  covers the byte codec directly (masking, fragment joining, a frame delivered
  one byte at a time, an orphan continuation frame).

The guard was **verified to fail on the pre-fix code**: restoring
`const socket = new WebSocket(webSocketUrl);` in `cdp.mjs` makes
`never constructs the global WebSocket in the CDP client` fail with
`expected … not to match /\bnew\s+WebSocket\s*\(/` (1 failed, 13 skipped).

### 13.4 Verification results (round-4 commit)

The harness was verified on the project's minimum Node version, not only on the
development one. Two Node lines were installed for this: Node 20.9.0 (the
Next.js 16 `engines` floor) and the latest Node 20 LTS (20.20.2).

| Check | Command | Result |
|---|---|---|
| Browser regression test, Node 24.15.0 | `npm run test:e2e` | **exit 0**, 9/9 · `transport global WebSocket` |
| Browser regression test, Node 20.20.2 | `npm run test:e2e` | **exit 0**, 9/9 · `transport built-in fallback WebSocket` |
| Browser regression test, Node 20.20.2 + `--experimental-websocket` | `NODE_OPTIONS=--experimental-websocket npm run test:e2e` | **exit 0**, 9/9 · `transport global WebSocket` |
| **Browser regression test, Node 20.9.0 (project minimum)** | `npm run test:e2e` | **exit 0**, 9/9 · `transport built-in fallback WebSocket` |
| Same test on the **pre-fix** `cdp.mjs`, Node 20.9.0 | `git show 39ed0b0:…/cdp.mjs` + `npm run test:e2e` | **exit 1** — `ReferenceError: WebSocket is not defined` at `cdp.mjs:14:18` |
| Harness regression tests, Node 24.15.0 | `npx vitest run tests/unit/e2e/` | **14 passed** (2 files) |
| Harness regression tests, Node 20.20.2 | `npx vitest run tests/unit/e2e/` | **13 passed, 1 skipped** — the native-transport test skips itself, as designed, when the global is absent |
| Focused S4 tests (7 files, §11.5 set) | `npx vitest run` on the §11.5 file set | **87 passed** |
| Full unit suite, Node 24.15.0 | `npx vitest run` | **228 files / 3128 tests passed**, exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Production build | `npx next build --webpack` | exit 0 |
| Whitespace | `git diff --check` | clean |
| Integration tests | — | not run: no Application, Domain or persistence change |

The browser measurements are **identical across the native and fallback
transports and across Node 20.9.0 / 20.20.2 / 24.15.0**, which is the evidence
that the transport swap changed nothing observable: `64px` and one row at 100%
text for all three widths, `180px`/3 rows at 320px 150%, `328px`/4 rows at
320px 200%, `127px`/2 and `328px`/4 at 375px, `132px`/2 and `232px`/3 at 393px —
the same figures as §12.3. DOM order, keyboard focus order and measured visual
order were `/ → /programs → /exercises → /login` in every one of the 36
combinations (9 per runtime), with labels, the 44px floor, the focus ring and
the no-overflow assertions all green.

### 13.5 Round-4 limitations

1. **The fallback is `ws://` only.** Chrome's DevTools endpoint never uses
   `wss://`, so this cannot be hit by `npm run test:e2e`; a `wss://` URL throws
   `the dependency-free WebSocket fallback supports ws:// only` instead of
   failing obscurely. No extension negotiation (permessage-deflate) is
   implemented either — the CDP client does not ask for any.
2. **The fallback is a compatibility shim, not a general WebSocket library.** It
   implements exactly the API surface `cdp.mjs` drives (`addEventListener`,
   `send`, `close`) and validates that surface at connect time
   (`assertWebsocketTransport()`). It is not a candidate for production use and
   is not exported outside `tests/`.
3. **The unit-test *runner* has a higher floor than the application.** Vitest
   4.1.11's bundler (`rolldown`) requires `^20.19.0 || >=22.12.0`, so
   `npx vitest run` cannot even start on Node 20.9.0
   (`SyntaxError: The requested module 'node:util' does not provide an export
   named 'styleText'`). That is a dev-toolchain constraint, independent of this
   finding: the E2E harness runs on plain `node` and was verified on 20.9.0.
4. **On Node 20 the jsdom half of the unit suite does not run** — `undici@8`
   (pulled in by `jsdom@30`, both dev dependencies) needs
   `webidl.util.markAsUncloneable`, which a newer Node provides. On Node 20.20.2
   the run reports 188 files / 2716 tests passed with 40 pre-existing
   "Failed to start forks worker" errors for jsdom component files. None of them
   involve this change, and none of them are the §13.3 test files (which use the
   `node` environment).
5. **Sandbox notes for reproducing §13.4.** The verification container has no
   root, no system PostgreSQL and no Docker, and it blocks unprivileged user
   namespaces. PostgreSQL 15 and Chrome 155 were therefore assembled from Debian
   packages and the Chrome-for-Testing archive into a user prefix, and Chrome is
   launched through the harness's documented `CHROME_PATH` override pointing at a
   two-line wrapper that adds `--no-sandbox` plus the library path. **The
   committed harness is unchanged by this**: no Chrome flag, argument list,
   assertion or measurement was modified for the run.
6. Beyond-200% text, real iOS/Android safe areas, Safari/Firefox, real screen
   readers, pinch-zoom and RTL remain unverified, as in §11.4 items 4–6.

## 14. P1 review — remove custom browser infrastructure

`AGENTS.md` requires Playwright for E2E and limits automation to critical
journeys. `docs/testing.md` explicitly excludes styling/layout E2E tests.
Inspection found no Playwright dependency, configuration or critical journey
to extend. The smallest compliant change is the documented manual browser
verification option, with the existing focused unit tests retained.

Removed the CDP runner/client, browser process management, WebSocket selector,
fallback and frame codec, transport/compatibility tests and echo server. Removed
`test:e2e` from package.json; no dependency or lockfile change is needed. No
application UI code changed. No replacement automation framework, unused browser
helper or standalone layout E2E command remains.

The manual checklist preserves the 320/375/393px × 100/150/200% matrix, actual
Tab/Shift+Tab navigation, bounding-box reading order, whole labels, 44px controls,
focus-visible indicators and navigation-attributable horizontal overflow. The
focused header tests still guard DOM order and the structural cause of the
regression; jsdom cannot prove measured order or real keyboard behavior.

Manual browser verification is documented, not newly executed in this revision; the
previous browser measurements in §§11–13 remain historical evidence only.

This addresses the P1 without changing the testing policy. Future automated
critical journeys must use Playwright. No merge or S5 work is included.

### P1 validation

| Check | Result |
|---|---|
| Focused navigation unit tests (6 files) | 78 passed |
| Full unit suite (`npm test`) | 226 files / 3114 tests passed |
| Lint (`npm run lint`) | exit 0 |
| TypeScript (`npx tsc --noEmit`, after build) | exit 0 |
| Production build (`npx next build --webpack`) | exit 0 |
| `git diff --check` | clean |

The default Turbopack build failed first fetching Google Fonts, then on a
restricted port bind after retrying with network access. The webpack production
build passed without source changes. An initial standalone TypeScript run raced
with build cleanup of `.next/types`; the rerun after the successful build passed.
Integration tests were not run: no application, domain or persistence changes.


## 15. Remaining P1 — test observable navigation contracts

Reviewed `AGENTS.md`, including lines 395–401, and `docs/testing.md`. Audited
all tests and helpers added or modified between S3 (`e0471e80`) and the expected
S4 HEAD (`8dde6bc5c2d54669fdd017fc2b7e7142086e9734`). This section supersedes
earlier claims that source/class guards prove geometry or visual reading order.
Application UI, dependencies and testing configuration are unchanged.

| Audited file | Resolution |
|---|---|
| `architecture/mobile-navigation-integrity.test.ts` | Removed all 17 source guards. Geometry, token values, utility ordering, JSX composition and formatting are not architectural contracts. Existing DOM/nav-model tests retain destinations, auth-aware wordmarks, History availability, session-route suppression and active state. |
| `architecture/mobile-bottom-bars.test.ts` and `helpers/fixed-bottom-scan.ts` | Removed the CSS scanner, its five self-tests and five source-composition checks. Counting files containing particular utilities cannot establish visible bars on a route. Session action availability is tested by rendering; visible bar counts remain browser checks. |
| `architecture/auth-aware-navigation.test.ts` | Replaced source regex/string assertions with three TypeScript syntax-tree guards, justified below. Removed early-return, filter-call, JSX prop threading, href spelling and clearance assertions. Auth/link outcomes are covered in rendered DOM. |
| `components/shared/mobile-tab-bar.test.ts` | Removed utility, icon-size, wrapper/label structure and whole-markup equality checks. Retained named navigation, link labels/hrefs, decorative-icon accessibility, auth/session suppression and History-detail behavior. Server/client comparison now checks navigation semantics. Added a mounted-component route-change regression for nested Programs/Exercises and a similarly prefixed non-destination. |
| `components/shared/app-shell-headers.test.ts` | Replaced six S4 class/structure tests with one semantic regression: full public control names, hrefs, DOM order and native tab eligibility. Existing account, wordmark, auth and active-state tests remain. |

Also replaced the older responsive-class assertion in
`features/dashboard/recent-training-card.test.ts` with the History link contract
inside the named Recent training region. Its loaded, empty and unavailable
History-entry cases remain. New
`features/sessions/session-navigation.test.ts` renders the real active and
completed screens and finish controls (unrelated exercise editors are stubbed):
an active workout offers an enabled submit action; completion offers the workout
details link and no further Finish workout button. These tests intentionally do
not assert how many breakpoint-specific controls are visible in jsdom.

The only retained source-check exceptions in the audited set are in
`auth-aware-navigation.test.ts`, using the existing TypeScript dependency:

1. Shared navigation must not import feature modules. This is a dependency
   boundary; identical DOM could conceal an invalid dependency.
2. The shared navigation model must remain server-usable, without a client/server
   directive, Next router dependency or React state-hook calls. Client DOM cannot
   establish whether a module is safe to import on the server.
3. Authentication resolution belongs to the layout (one `getCurrentUser` call),
   with no independent auth/fetch calls in shared navigation. The same links
   could render after duplicate session reads, so behavioral assertions alone
   cannot enforce this ownership rule.

No CSS/source-geometry exception remains. The syntax-tree guards inspect imports,
directives and calls rather than whitespace, quote style, utility order or JSX
serialization. No test was moved to another directory merely to evade the audit.

Verification uses Vitest and the existing jsdom/react-dom component pattern.
No E2E suite, custom browser harness, new library or layout-only Playwright test
was introduced. AGENTS.md reserves Playwright E2E for critical journeys; this
revision changes tests and documentation only.

### Verification and browser limitations

The real-browser measurements and screenshots documented in §§5–13 are
preserved as historical evidence. No new browser measurements were performed
for this test-only revision. The manual checklist remains the required way to
verify CSS layout: viewport/text-size matrix, clipping, 44px targets, safe-area
clearance, visible focus, overflow, breakpoint-specific bar counts and actual
Tab/Shift+Tab versus measured visual order. jsdom does not validate any of these.
Known limitations remain, including real iOS/Android safe areas, Safari/Firefox,
screen readers, pinch zoom, RTL and beyond-200% text. The previously recorded
28px wordmark height and enlarged-text program-card overflow are not resolved by
these tests. No merge or S5 work is included.

Validated on Node 24.19.0:

| Check | Result |
|---|---|
| Focused S4/navigation tests (7 files) | 55 passed |
| Full unit suite (`npm test`) | 225 files / 3075 tests passed |
| TypeScript (`npx tsc --noEmit`, after build) | exit 0 |
| Lint (`npm run lint`) | exit 0 |
| Production build (`npm run build -- --webpack`) | exit 0 |
| Whitespace (`git diff --check`) | clean |

Focused command: `npx vitest run tests/unit/architecture/auth-aware-navigation.test.ts tests/unit/architecture/training-progress.test.ts tests/unit/components/shared/mobile-tab-bar.test.ts tests/unit/components/shared/app-shell-headers.test.ts tests/unit/components/shared/nav-items.test.ts tests/unit/features/sessions/session-navigation.test.ts tests/unit/features/dashboard/recent-training-card.test.ts`.

The default `npm run build` failed with Turbopack's restricted local-port bind
(`Operation not permitted`); the approved retry outside the sandbox reported the
same error. The webpack production build passed without application changes.
The first new completed-panel test run exposed an omitted `programCompletion:
null` fixture prop; that fixture was corrected before the passing runs above.
Integration tests were not run: no application, domain or persistence changes.
