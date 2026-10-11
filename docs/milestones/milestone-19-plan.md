# Milestone 19 Plan — Training Experience & Navigation Integrity

Semantic authority: `AGENTS.md` + `docs/ui.md` + `docs/error-handling.md` plus the locked M8–M18 canonical docs. This plan never restates an existing contract; where it and a canonical doc disagree, the canonical doc wins. M19 introduces **no new product concept, metric, or persisted state**, and changes **no** M8–M18 semantic or owned copy.

---

## 1. Milestone objective

M18 shipped Progress. The audit that followed established that the navigation and resilience layer did not keep up with M13–M18. Five defects, all verified in-repo at `0105042c`:

1. **No `loading.tsx` anywhere** — `find src/app -name 'loading.tsx'` returns **0**. Every private page is an `async` Server Component doing several sequential awaited DB reads before first paint with no instant fallback. `Suspense` appears exactly **once** in all of `src/` (`exercises/page.tsx:37`), guarding only the filter bar.
2. **No `error.tsx` anywhere** — `find` returns **0** (`error.tsx` and `global-error.tsx` both absent). `docs/error-handling.md:358` states *"Every route group should have an `error.tsx`"*, and the codebase painstakingly implements degrade-don't-crash (`progress-view.ts:225-230`, `dashboard-view.ts`, `history-view.ts`) — then leaves the outermost layer unprotected, so a failure in `requireUser()`, the profile lookup or the program read renders a raw Next.js error screen and loses the whole page.
3. **Signed-out visitors are shown private destinations as reachable.** Verified by HTTP against a running dev server in the audit: `/programs` signed-out rendered `Dashboard Programs Exercises History Progress Sign in`. `History` and `Progress` are private and bounce to `/login?next=…`. The mobile tab bar likewise offers `Home → /dashboard`, a private route.
4. **Catalog and personal exercise history never reference each other.** `ExerciseDetail.tsx` renders only static catalog fields; zero `history/exercises` references exist in `src/features/exercises/`.
5. **`/progress` was added to desktop nav only** (`AppNavLinks.tsx:13`) while `MobileTabBar` still ends in `Profile`, pinned by M18's own guard (`training-progress.test.ts:80`).

M19 makes the shipped product **honest, reachable and resilient** without inventing any new capability. It is a milestone about the surfaces users already use, not about new product concepts.

---

## 2. Verified repository baseline

| Surface | File | Current contents |
|---|---|---|
| Desktop nav | `AppNavLinks.tsx:8-14` | `/dashboard`, `/programs`, `/exercises`, `/history`, `/progress` (5) |
| Mobile tabs | `MobileTabBar.tsx:9-18` | `/dashboard`, `/programs`, `/exercises`, `/profile` (4); reads only `usePathname`, no auth prop |
| Desktop header | `AppHeader.tsx:24` | `hidden … md:block`; account slot else `Sign in` |
| Mobile header | `MobileHeader.tsx:19-28` | `md:hidden`; wordmark left, account slot else `Sign in`; **no nav links** |
| Account menu | `AccountMenu.tsx:127-138` | `Profile` link + `Sign out` form, desktop + mobile variants |
| Shell | `(app)/layout.tsx:37-56` | resolves `getCurrentUser()` once (`cache()`-deduplicated); composes account slot; single `<main>` with `pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0` |

**Resilience (verified):** `loading.tsx` 0 · `error.tsx` 0 · `global-error.tsx` 0 · `not-found.tsx` 1 (root, links only `/exercises`) · `Suspense` 1 use · skeleton components 0.

**Framework (verified):** Next.js `16.3.1`, React `19.2.8`, Vitest `4.1.11`. Scripts (`package.json`): `dev`, `build` (`next build`), `lint` (`eslint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:integration` (`vitest run --config vitest.integration.config.ts`), `db:generate`, `db:migrate`, `db:seed`.

**Test baseline (verified):** 216 unit test files, 49 integration files, 0 E2E files. Architecture guards live in `tests/unit/architecture/`: `follow-through`, `run-closure`, `schedule-not-performed`, `settlement-presentation`, `session-creation-authority`, `training-progress`.

**Open-redirect machinery already exists — M19 adds none.** `auth-schemas.ts:57-115` provides `resolveSafeNextPath` (rejects empty, backslash, protocol-relative `//`, absolute, and percent-encoded smuggling; normalizes against `APP_ORIGIN = 'https://fit40.local'`; always returns a relative path or `null`) and `nextPathSchema`. Consumers: `login/page.tsx`, `register/page.tsx`, `actions/login.ts:75-78`, `current-user.ts:33-40`.

**Private-workout sign-in-and-continue already implemented** — `WorkoutStartPanel.tsx:96-99` builds `primaryHref = ctaState === 'anonymous' ? \`/login?next=${encodeURIComponent(sessionPath)}\` : sessionPath`. **S6 must only verify this, not rebuild it.**

**Logging / degrade convention (verified, mirrored by S2 & Correction 2):** the view-mapper layer catches, calls `console.error('Unexpected failure …', error)` including the user id, and returns a typed `{ status: 'unavailable' }` — never a zeroed success. See `progress-view.ts:225-230`.

**Constraint S4 must update** — `training-progress.test.ts:80` pins `['/dashboard','/programs','/exercises','/profile']`. Updating it is sanctioned by the approved decision; it is an M18 regression guard, not an M8–M18 semantic.

**Build constraint** — `milestone-18-plan.md` records Turbopack `pnpm build` failing on a CSS worker-port binding while `--webpack` succeeds. Report honestly; claim no Turbopack success.

---

## 3. Approved product decisions

LOCKED. Not open for renegotiation in this milestone.

1. **Mobile tabs = exactly four:** `Home → /dashboard`, `Programs → /programs`, `Exercises → /exercises`, `Progress → /progress`. `Profile` is **replaced** by `Progress`. No fifth tab, no navigation drawer, no redesign of the tab bar.
2. **Profile stays reachable** via the existing account menu (renders on both headers, both breakpoints — `(app)/layout.tsx:43,46`).
3. **History stays reachable** via the dashboard and contextual links; extra discoverability verified in S6 **without** a tab.
4. **Public catalog pages stay accessible** unauthenticated (`/programs`, `/programs/[slug]`, `.../workouts/[o]`, `/exercises`, `/exercises/[slug]`).
5. **Signed-out visitors:** do not display private destinations as if available. **Prefer hiding** private-only destinations from main navigation. Where a user explicitly attempts a private action, provide a clear sign-in-and-continue path preserving the intended destination via the validated `next` mechanism. No open-redirect vulnerabilities.
6. **Signed-in visitors:** preserve existing navigation behavior except the approved mobile tab replacement; maintain active states, accessibility labels, keyboard navigation and touch targets.
7. **Exercise detail → history link:** presence-only, authenticated-with-history only, no metrics or preview values, never signed-out, public access preserved, performed-exercise attribution (incl. substitutions) preserved.
8. **Loading feedback** for the most important routes; **recoverable error boundaries** per existing conventions; truthful `unavailable` states not replaced by generic errors; DB/schema/config failures not masked as successful empty results.

### Correction 1 (applied) — signed-out mobile navigation

Do **not** render a reduced two-tab bottom bar for signed-out visitors. Instead:

- **Hide the mobile bottom tab bar entirely** when the visitor is signed out. There is no authenticated destination worth a primary tab for them (`Home` and `Progress` are private), and a two-item bar would still advertise `Home`, a private route.
- Keep public **Programs** and **Exercises** accessible through **header navigation or page content** (see S3.3). No new navigation component is introduced.
- Preserve **sign-in** access (the mobile header already renders `Sign in` for signed-out).
- Preserve **public catalog browsing**.

### Correction 2 (applied) — exercise-history presence is a tri-state, not a boolean

Do **not** convert a failed history read into a confirmed "no history". The use-case / read-model result distinguishes three states:

- `present` — at least one completed occurrence exists. **Only this state permits rendering the link.**
- `absent` — a successful read found no completed occurrence. No link.
- `unavailable` — the read failed. **No link**, but the failure stays distinguishable in the contract and is **logged** via the existing `console.error` convention.

An `unavailable` read must **not** crash the public exercise detail page. It omits the link, exactly as `absent` does, while remaining observably distinct in the contract. No new persistence or infrastructure.

### Correction 3 (applied) — verify error-boundary scope against the installed version before coding

Correction 3 requires an **implementation-time verification step**, documented in S1: confirm Next.js App Router `16.3.1` error-boundary behavior against the actual route layouts before placing boundaries. See S1.2 for the specific cases and the required verification protocol. **This plan does not assume** that a boundary automatically covers its own layout.

---

## 4. Locked behavioral contracts

**4.1 Four failure classes stay distinct** — an error boundary must never blur them.

| Class | Mechanism | Renders |
|---|---|---|
| Auth redirect | `requireUser` → `redirect('/login?next=…')` | login page (a navigation, never an error) |
| Not found | `notFound()` / malformed params | `not-found.tsx` (404) |
| Expected domain/application error | `Result.err` → typed view state | truthful `unavailable` / empty copy |
| Unexpected rendering failure | thrown | **new** `error.tsx` with `retry()` |

`redirect()` throws `NEXT_REDIRECT`; `notFound()` throws `NEXT_NOT_FOUND`. **Neither may be caught, logged as an error, or converted to boundary UI.** The error boundary must re-throw these sentinel errors unchanged.

**4.2 No fabrication** — loading placeholders carry no numbers, dates, names or values; geometry only.

**4.3 Truthful `unavailable` survives** — never converted to an error page or zero-filled.

**4.4 Navigation honesty** — private destinations are **omitted**, not disabled, badged or tooltipped.

**4.5 Performed-exercise attribution** — any existence read is keyed on the performed `ExerciseId`; a substituted occurrence credits the replacement (M12's rule), never the authored exercise.

**4.6 Touch targets & a11y** — ≥44px, `aria-label="Primary"` on tab nav, `aria-current="page"` for active, status conveyed by text + semantics never colour alone.

---

## 5. Architecture and data-access implications

Route files (`loading`/`error`/`not-found`) render shared components and perform **no** data access. `AppNavLinks`/`MobileTabBar` keep **zero feature imports** (enforced by `app-shell-headers.test.ts` and the guard added in S6); auth state arrives as a prop from the layout. `error.tsx` is the only intentional Client Component addition. S5's read lives in `src/application/use-cases/`, wired in `src/features/exercises/services.ts`.

| Layer | Change |
|---|---|
| Domain | **None** |
| Application | S5 only: one read-only use case + a tri-state DTO/mapper |
| Infrastructure | **None** — S5 reuses `listCompletedExerciseOccurrences`; no new port, migration or schema change |
| Presentation | S1–S6: route files, shared primitives, nav props, one conditional link |

**App Router error-boundary limitations to respect (Next 16.3.1, verify in S1):**
- `error.tsx` catches errors in its **child segments**, not in its own `layout` — hence a root `global-error.tsx` for root-layout failures.
- `global-error.tsx` must render its own `<html>`/`<body>` and cannot rely on the root layout.
- Boundaries do not re-render on navigation; `retry()` is the recovery action (`reset()` alone only clears the boundary — see §6).
- `loading.tsx` auto-wraps in a Suspense boundary.
- `not-found.tsx` is not an error state.
- Boundaries do **not** catch Server Action or event-handler errors (already handled by typed action state).
- In Next 16, `redirect()`/`notFound()` sentinels propagate through boundaries and must be re-thrown.

---

## 6. Slice 1 — Error boundary foundation

**Goal.** Unexpected failures show a recoverable, non-technical message instead of a raw error screen; auth redirects and 404s stay distinct; `retry()` recovers by fetching a fresh Server Component response.

**Preconditions.** None. Purely additive; independent of every other slice.

**Files.**
- NEW `src/app/global-error.tsx` — client, renders own `<html>`/`<body>`.
- NEW `src/app/(app)/error.tsx` — client, wraps all `(app)` children.
- NEW `src/app/(auth)/error.tsx` — client, for login/register (these call `getCurrentUser()`).
- NEW `src/components/shared/ErrorState.tsx` — server-safe, design-system only; reused by the boundaries and (optionally) by inline error copy.
- NEW `tests/unit/components/shared/error-state.test.ts`.
- NEW `tests/unit/architecture/error-boundaries.test.ts` (guard).
- Docs: `docs/error-handling.md` §328–361 becomes implemented; `docs/ui.md` note.

**6.1 Boundary placement (minimum correct).**
- `(app)/error.tsx` protects the mixed public/private `(app)` subtree. It does **not** cover the `(app)` layout itself; a failure inside `(app)/layout.tsx` (e.g. `getCurrentUser()` throwing) must be caught by `global-error.tsx`. Therefore **both** are required — a single boundary does not cover its own layout.
- `(auth)/error.tsx` protects login/register.
- `global-error.tsx` is the last resort for root-layout failures and must be self-contained.

**6.2 Verification protocol (Correction 3).** Before finalizing placement, confirm against `next@16.3.1` and the actual layouts:
1. Add a throwaway child that throws → confirm `(app)/error.tsx` catches and `retry()` re-renders (fetching a fresh response).
2. Make `(app)/layout.tsx` throw → confirm `(app)/error.tsx` does **not** catch it and `global-error.tsx` does.
3. Make the root layout throw → confirm only `global-error.tsx` catches.
4. `redirect('/login?next=…')` → confirm the boundary does not intercept; the login page renders.
5. `notFound()` → confirm `not-found.tsx` renders, not the boundary.
6. An expected `{status:'unavailable'}` view → confirm it renders its own copy, not the boundary.
Record findings; adjust placement if the installed version differs. Remove the throwaway probes before commit.

S1 evidence: the prior production HTTP probes verified boundary scope, redirects, 404s and streamed-payload privacy. The fresh-response `retry()` behavior was established by inspecting the installed Next.js 16.3.1 runtime. Current automated tests exercise only Fit40-owned component contracts and callback delegation; no real-browser end-to-end retry/recovery test was performed.

**6.3 Copy & a11y.** `ErrorState` reuses `EmptyState` geometry; no new tokens. Log via `console.error` (existing convention). **Never** render `error.message`. Approved framing: *"Something went wrong while loading this page."* / *"This is a temporary problem, not something you did."* with a `Try again` button wired to the framework `retry()` (not `reset()`), so recovery fetches a fresh Server Component response. Segment fallbacks use a non-landmark `<div>` (the route-group layout owns the single `<main>`); `global-error.tsx` keeps its own `<main>` because it owns the whole document. `global-error.tsx` uses plain styling (Tailwind may not have loaded). Do **not** add try/catch around existing degrade logic.

**6.4 Acceptance.**
- A throw in an `(app)` child page renders the recoverable boundary; `retry()` recovers by fetching a fresh response.
- `requireUser` redirect still reaches login (no boundary interception).
- `notFound()` still renders 404.
- A typed `{status:'unavailable'}` still renders its own copy, not the boundary.
- No stack trace or internal message in output; no banned vocabulary.
- Both segment boundaries are client; the root supplies `html`/`body`.
- Correction 3 verification recorded.

**6.5 Verification.** `pnpm typecheck && pnpm lint && pnpm test`. Manual: visit each covered route; force a failure and confirm recovery.

**6.6 Commit.** `feat(m19): recoverable error boundaries for root, auth and app segments`. Independently reviewable: **yes**.

---

## 7. Slice 2 — Loading state foundation

**Goal.** Heaviest private routes show an immediate, stable, non-fabricated placeholder. **Preconditions.** None; independent of S1.

**Routes (justified by read cost).**
- `/dashboard` — `dashboard/page.tsx:43` awaits program + enrollment + schedule + closure + history + insights.
- `/progress` — `progress/page.tsx:33-36` composes two reads.
- `/history` — `history-view.ts:221-243` runs three sequential reads.
- `/history/exercises/[slug]` — four reads.
- `/programs/[programSlug]` — enrollment + schedule + completion.
- `.../session` — active workout.

**Excluded:** public catalog routes (`/exercises`, `/programs`) — cheap already; latency UI there would be novelty, not value.

**7.1 Shared vs route-specific — no skeleton framework.** NEW `src/components/shared/RoutePlaceholder.tsx` (props `label`, optional `blocks`, `className`; `aria-hidden` geometry using `SectionCard` radius/border and the `bg-surface-2/50` treatment proven at `exercises/page.tsx:39-44`; one `role="status"` polite live region carrying only label text, never a number). Plus six `loading.tsx` files composing it with route-appropriate geometry: dashboard (header + card stack), progress (three chart-height blocks + summary), history (totals + rows), history/exercises (trend + rows), program detail (header + section cards), session.

**7.2 Nested behavior.** Deepest matching boundary wins: `/history → /history/exercises/[slug]` must show the exercise placeholder; `/dashboard → /programs/x` the program one.

**7.3 Layout stability & a11y.** Placeholder heights approximate the loaded layout to avoid shift. Geometry is `aria-hidden`; at most one polite status message; no digits.

**7.4 Acceptance.**
- Placeholder appears immediately on cold navigation for all six routes.
- Contains no number, date, exercise name or workout name.
- `aria-hidden` geometry + at most one `role="status"` message.
- Heights approximate the loaded layout (no large shift).
- Truthful unavailable/empty states are unchanged.
- Public catalog routes are untouched.
- Exactly one shared primitive; no framework.

**7.5 Verification.** typecheck, lint, test. Component assertions: no digits, `aria-hidden` present, `role="status"` present. Source-scan guard: every `loading.tsx` imports `RoutePlaceholder`.

**7.6 Commit.** `feat(m19): shared loading placeholders for the primary private routes`. Independently reviewable: **yes**.

---

## 8. Slice 3 — Authentication-aware navigation

**Goal.** Signed-out visitors see only destinations that truly work; the mobile tab bar is hidden for them (Correction 1); signed-in behavior is unchanged except the approved mobile tab.

**Preconditions.** None, but must land **before** S4.

**Files.** `(app)/layout.tsx` (pass `isAuthenticated` — no new read; `getCurrentUser()` is `cache()`d and already called at line 38); `AppHeader.tsx` (forward the flag); `AppNavLinks.tsx` and `MobileTabBar.tsx` (consume the flag); NEW `src/components/shared/nav-items.ts` — server-safe, zero `next/navigation` import, the single declarative source of truth for each destination, label, and a `requiresAuth` flag (removes today's two-file duplication). Tests: extend `app-shell-headers.test.ts`; NEW `nav-items.test.ts`, `tests/unit/architecture/auth-aware-navigation.test.ts`.

**8.1 Signed-in navigation (unchanged).** Desktop renders `Dashboard, Programs, Exercises, History, Progress`. Mobile renders the four tabs defined in S4. Active-route semantics (`usePathname`), 44px targets, ARIA labels preserved.

**8.2 Signed-out navigation (Correction 1).**
- **Desktop:** render only the public destinations `Programs`, `Exercises`, plus the existing `Sign in` control. `Dashboard`, `History`, `Progress` are **omitted** (private).
- **Mobile:** **hide the bottom tab bar entirely** (`MobileTabBar` returns `null` when `isAuthenticated === false`). No reduced two-tab bar.

**8.3 Public catalog reachability for signed-out (Correction 1).** With the mobile tab bar hidden, public Programs/Exercises remain reachable through:
- The desktop header nav (`Programs`, `Exercises`) — already present.
- The **mobile header**: add compact `Programs` and `Exercises` links to `MobileHeader` for signed-out visitors (wordmark left, public nav center/left, `Sign in` right), **reusing** `nav-items.ts` filtered to public entries. This keeps the tab bar hidden while preserving public browsing and sign-in. No new navigation component; `MobileHeader` already exists and already renders `Sign in`.
- Page content: the landing page and public pages already link into the catalog.

**8.4 `next` safety.** No new validation. Any producer uses `resolveSafeNextPath`/`nextPathSchema`. The guard asserts no `next=` is built by concatenating an unvalidated value, and no `@/features` import appears under `src/components/shared/`.

**8.5 Acceptance.**
- Signed out, desktop: exactly `Programs`, `Exercises` + `Sign in`; no `Dashboard`/`History`/`Progress`.
- Signed out, mobile: no bottom tab bar; public `Programs`/`Exercises` reachable via the header; `Sign in` present.
- Signed in, desktop: `Dashboard, Programs, Exercises, History, Progress`; signed in, mobile: the four S4 tabs.
- Active-route semantics identical in both auth states.
- Labels/hrefs defined in one module (`nav-items.ts`).
- Existing sign-in-and-continue (WorkoutStartPanel) regression-asserted.
- ≥44px targets, visible focus.

**8.6 Commit.** `feat(m19): hide private navigation destinations from signed-out visitors`. Independently reviewable: **yes**, but before S4.

---

## 9. Slice 4 — Mobile navigation integrity

**Goal.** `Progress` reachable in one tap for authenticated users; `Profile` one tap via the account menu; the four-tab locked bar preserved; the bar hidden for signed-out visitors (S3). **Preconditions.** S3 merged (S3 introduces the auth filter and `nav-items.ts`).

**Files.** `nav-items.ts` (mobile authenticated set → `Home / Programs / Exercises / Progress`); `MobileTabBar.tsx` (consume `isAuthenticated`, hide when false; `Progress` icon from `lucide-react`, consistent with the 22px set — **verify the export by import, do not guess**; fall back to an icon already used such as `TrendingUp`/`ChartLineIncreasing`/`Activity`); `training-progress.test.ts:80` (update pinned array to `['/dashboard','/programs','/exercises','/progress']` and retitle the test); `docs/ui.md`; `README.md`.

**Explicitly preserved.**
- `MobileTabBar.tsx:33-35` returns `null` on `/session` so the screen shows its own `SessionFinishBar` — **do not touch**.
- `(app)/layout.tsx:51` `pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0` clearance — **do not change**.
- Safe-area padding, 76px height, four slots, ≥44px targets, `aria-label="Primary"`, `aria-current`.

**Profile discoverability.** `AccountMenu` renders on both headers/breakpoints; the mobile trigger is a 44px `size-11` around the 32px avatar. S6 asserts reachability rather than assuming.

**History discoverability.** No tab added. Verify reachability from desktop nav, the dashboard's Recent training card, and exercise-history routes; confirm a dashboard link reaches history at 375px. If unreachable, the minimal fix is **one dashboard link**, never a nav change.

**Acceptance.**
- Authenticated tabs in order `Home`, `Programs`, `Exercises`, `Progress`; exactly four.
- No Profile tab; Profile via account menu.
- Signed out: tab bar hidden (S3).
- Active tab correct per route.
- Session routes still hide the tab bar and show the finish bar — no double bar, gap or overlap.
- Safe-area / 76px geometry unchanged.
- M18 guard updated in the same commit and passing.

**Commit.** `feat(m19): mobile Progress tab replacing Profile; hide tab bar for signed-out`. Independently reviewable: **yes**.

---

## 10. Slice 5 — Exercise catalog ↔ personal history

**Goal.** Signed-in users with completed history get a contextual link; everyone else sees today's page. **Preconditions.** None.

**Architecture decision.** Reading history inside `ExerciseDetail` is **rejected** — `src/components/**` must not import ports/infrastructure (enforced by the repo's source-scan guards). The compliant path mirrors `features/history/services.ts`.

- NEW `src/application/use-cases/get-exercise-history-presence.ts` — `GetExerciseHistoryPresenceUseCase(trainingHistoryRepository, exerciseRepository)`. `execute({userId, slug})` returns a **tri-state** (Correction 2):
  - resolve the exercise by slug; unknown slug → `EXERCISE_NOT_FOUND` (same contract as `get-exercise-by-slug.ts`).
  - validate `userId` → `INVALID_INPUT` with no repository call.
  - call the existing `listCompletedExerciseOccurrences(userId, exerciseId, 1)`.
  - non-empty → `{ status: 'present' }`; empty → `{ status: 'absent' }`; a thrown/rejected read → `{ status: 'unavailable' }` (logged, not rethrown).
- NEW `src/application/dto/exercise-history-presence.ts` — the tri-state type + mapper. No metric, value, preview or count.
- `features/exercises/services.ts` — compose beside the existing two.
- NEW `features/exercises/exercise-history-presence-view.ts` — async assembly; logs on `unavailable` (same `console.error` convention), and passes `personalHistoryHref` **only** when `present`.
- `exercises/[slug]/page.tsx` — after `getExercise`, `getCurrentUser()`; if non-null, read presence and pass `personalHistoryHref` only when `present`.
- `ExerciseDetail.tsx` — optional `personalHistoryHref?: string`; render one link when present.

**Why limit-1 reuse.** Contract (`training-history-repository.ts:176-190`, impl `:258-276`): user-scoped, completed-only, ≥1 logged set, batched hydration; `exercise_id` persists the **performed** exercise (`:210-212`), so substitution attribution is correct by construction.

**Query-cost concern (mitigated).** The method hydrates sets, wasteful for a boolean. Option (a) reuse as-is — simplest, one bounded read; option (b) add a dedicated `hasCompletedExerciseOccurrence` using `SELECT 1 … LIMIT 1` with no hydration. **Default (a); escalate to (b) only if inspection shows measurable cost** — honoring "smallest practical change" and "no abstractions without demonstrated need."

**Tests.**
- Use-case unit (fake ports): invalid userId → `INVALID_INPUT`, no repo touched; unknown slug → `EXERCISE_NOT_FOUND`; one occurrence → `present`; empty → `absent`; rejected read → `unavailable` and logged, not rethrown; bounded (`limit === 1`); resolved id forwarded.
- Component: link only when `personalHistoryHref` present; absent and unavailable both render no link.
- Page: signed out ⇒ use case never called.
- Integration `tests/integration/database/exercise-history-presence.test.ts`: present; absent; **substituted** occurrence credits the replacement; skipped/zero-set → absent; detached session → present; another user's history → absent; statement-count bound.

**Acceptance.**
- Signed in with history → exactly one link to `/history/exercises/[slug]`.
- Without history → no link, page identical.
- Signed out → no link, no read, page identical.
- `EXERCISE_NOT_FOUND` still 404.
- A failed read → no link, page renders, failure logged and typed `unavailable` (Correction 2).
- No port/repo/infrastructure import in `src/components/**`.
- No metric, value, count or preview.
- No new table/migration.

**Commit.** `feat(exercises): contextual tri-state link to personal exercise history`. Independently reviewable: **yes**.

---

## 11. Slice 6 — UX polish and regression coverage

**Goal.** Small verified corrections, then seal. **Not a redesign.** **Preconditions.** S1–S5 merged.

| # | Item | Status (verified) | Action |
|---|---|---|---|
| 1 | Landing `LogoutButton` | **Present** `src/app/page.tsx:4,41`; `ui.md:199-202` calls it a leftover | **Remove**; keep the `Dashboard` CTA |
| 2 | Context-aware 404 | Root `not-found.tsx` links only `/exercises` | Add a sign-in/dashboard-aware secondary link; minimal |
| 3 | Workout sign-in-and-continue | **Already implemented** `WorkoutStartPanel.tsx:96-99` | **Verify only** + regression test |
| 4 | History discoverability on mobile | Verify after S3/S4 | One dashboard link if unreachable; else document |
| 5 | Consistent nav copy / a11y | — | Assert via `nav-items.ts` |
| 6 | Responsive regression | — | jsdom both auth states/breakpoints + documented manual checks |

**Explicitly excluded:** the `/exercises` payload (111,292 bytes for 17 exercises, verified by HTTP). Fine at current size; pagination now is novelty. Recorded as a known limit.

**11.1 M19 architecture guards (source-scan idiom, mirroring `training-progress.test.ts`).** NEW `tests/unit/architecture/m19-navigation-integrity.test.ts`:
- No `@/features` import under `src/components/shared/`.
- No `any`/`as any`/`@ts-ignore`/`!` non-null assertion in files added by S1–S6.
- No `Date.now()`/`new Date()` added in `src/domain/` or `src/application/`.
- Exactly one `RoutePlaceholder` definition; every `loading.tsx` imports it.
- `MobileTabBar` reads an auth prop and returns `null` when unauthenticated (no hard-coded signed-in tabs).
- Authenticated mobile tabs are exactly the approved four in order.
- Banned vocabulary absent from new copy: `adherence`, `streak`, `missed`, `failed`, `on track`, `readiness`, `e1rm`, `score`.
- No `next=` assembled from an unvalidated value.
- `features/exercises/**` (except `services.ts`) imports no port/infrastructure.
- `ErrorState`/boundaries render no `error.message` and no stack text.

**11.2 Acceptance.** All guards green; landing logout removed; 404 context-aware; sign-in-and-continue regression passes; docs updated; manual responsive checks recorded.

**11.3 Commit.** `docs(m19): canonical docs, screen notes and navigation-integrity guards`. Independently reviewable: **yes**.

---

## 12. Test and verification matrix

**12.1 Per slice.**

| Slice | Unit | Component | Integration | Guard / manual |
|---|---|---|---|---|
| S1 | `error-state.test.ts` + `error-boundary-recovery.test.ts` | boundary rendering/privacy/accessibility + supplied `retry` callback (including repeated invocation) + single-`main` composition | — | throwaway throw probes (Correction 3); manual per-route |
| S2 | `RoutePlaceholder` unit | no digits, `aria-hidden`, `role=status` | — | source-scan: all `loading.tsx` import the primitive |
| S3 | `nav-items.test.ts` | jsdom both auth states | — | `auth-aware-navigation.test.ts`; manual 375/393/1440 |
| S4 | nav-items update | active-state assertions | — | update M18 guard; manual tab + session-hide |
| S5 | use-case (fake ports) | link only when present | `exercise-history-presence.test.ts` | `components/**` no-infra guard |
| S6 | — | — | — | `m19-navigation-integrity.test.ts`; responsive sweep |

**12.2 Milestone gate (scripts verified in `package.json`).** `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm test:integration` · `pnpm build -- --webpack` (report Turbopack honestly). Baseline: 216 unit files, 49 integration files; typecheck + lint exit 0; webpack build exit 0.

**12.3 Manual verification (report only if executed).**
- Mobile 375px & 393px: authenticated four-tab bar; signed-out hidden bar + header public nav; session route hiding; placeholders; forced error boundary.
- Desktop 1440px: five-item nav signed in; `Programs`/`Exercises` + `Sign in` signed out; active states; history link present/absent.
- Keyboard traversal and visible focus; screen reader if available.

---

## 13. Dependency and execution order

```
S1 (errors)   ── independent of S2
S2 (loading)  ── independent of S1
S3 (auth nav) ──> S4 (mobile tab list)     [S3 defines the filter + nav-items.ts that S4 applies]
S5 (catalog↔history) ── independent of S1–S4
S6 (polish + guards + docs) ── depends on S1–S5
```

**Order: S1 → S2 → S3 → S4 → S5 → S6.** S1 first (highest-severity verified defect, purely additive, gives later slices a safety net). S2 second (same character, immediately visible). **S3 before S4 is mandatory** — S3 introduces the auth filter and `nav-items.ts`, so S4 changes only the tab list and the hide-for-signed-out behavior; reversing them would edit `MobileTabBar` twice. S5 fourth (independent; the only slice touching Application code). S6 last. Every slice ships independently with none leaving the build broken.

---

## 14. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Boundary intercepts `NEXT_REDIRECT`/`NEXT_NOT_FOUND` | Contract 4.1; explicit probes; never try/catch `redirect()`/`notFound()` |
| R2 | Boundary assumed to cover its own layout | Correction 3 verification protocol (S1.2); both segment + root boundaries |
| R3 | Placeholders fabricate facts / cause shift | No digits; geometry mirrors first paint; guard forbids duplicate markup |
| R4 | Boundaries mask DB/schema/config failure as success | Only unexpected throws reach boundaries; `unavailable` never replaced; failures logged |
| R5 | Signed-out mobile loses catalog reachability when bar hidden | Header public nav (S3.3) + existing page-content links; manual 375/393 check |
| R6 | Replacing `Profile` tab breaks a habit path | Account menu on both breakpoints, 44px target; S6 asserts reachability |
| R7 | S4 breaks the M18 guard | Guard updated in the same commit, retitled |
| R8 | S5 adds N+1 / over-fetches | Bounded limit-1, one batched statement; statement-count test |
| R9 | S5 500s a public page for signed-in users | Tri-state: `unavailable` omits the link and logs; page renders regardless |
| R10 | S5 leaks data across users | User-scoped read; integration asserts another user → `absent` |
| R11 | `lucide-react` Progress icon may not exist | Verify by import; fall back to an already-used icon |
| R12 | `LogoutButton` removal breaks a consumer | Check all call sites; remove usage, delete file only if no other consumer |
| R13 | Turbopack build fails (known) | Use `--webpack`; report Turbopack honestly |
| R14 | Scope creep into redesign | S6 non-goals; audit-justified corrections only |
| R15 | Accidental client/server boundary change | `error.tsx` is the only intentional client addition; guard asserts no stray directive |

---

## 15. Explicit non-goals

No new training metrics or analytics · no bodyweight/duration progression trends · no all-time comparisons · no new prescription logic · no change to M8 progressive overload · no change to M12 personal-record semantics · no change to M13–M18 historical reporting · no goals, streaks, adherence scores or quotas · no recovery/readiness/fatigue interpretation · no medical or coaching recommendations · no new database tables or migrations · no persisted analytics state · no mobile tabs beyond the approved four · no charting libraries · no large UI redesigns · no unrelated refactoring · no unnecessary dependencies · no navigation drawer · no skeleton framework · no reduced two-tab signed-out bar (Correction 1) · no boolean history-presence that hides failure (Correction 2).

**Exercise Progression Depth is deferred to a potential M20 and must not be implemented in M19.**

---

## 16. Final milestone acceptance checklist

- [ ] S1 committed: root `global-error.tsx` + `(app)/error.tsx` + `(auth)/error.tsx` + `ErrorState`; redirect/404/unavailable proven distinct; Correction 3 verification recorded.
- [ ] S2 committed: one `RoutePlaceholder`; `loading.tsx` on the six routes; no fabricated values; no layout shift.
- [ ] S3 committed: `nav-items.ts` single source; private destinations hidden signed-out; mobile tab bar hidden signed-out; header public nav added; no feature import in shared.
- [ ] S4 committed: authenticated tabs `Home/Programs/Exercises/Progress` in order; session bottom-bar preserved; M18 guard updated.
- [ ] S5 committed: tri-state presence; link only on `present`; public page unchanged signed-out; integration covers substitution/ownership/detached/unavailable/statement-count.
- [ ] S6 committed: landing logout removed; context-aware 404; sign-in-and-continue regression; docs + guards.
- [ ] `pnpm typecheck` exit 0.
- [ ] `pnpm lint` exit 0.
- [ ] `pnpm test` green.
- [ ] `pnpm test:integration` green.
- [ ] `pnpm build -- --webpack` succeeds; Turbopack status reported honestly.
- [ ] All M19 guards green.
- [ ] **No change to any M8–M18 semantic, copy or surface** (except the sanctioned M18 nav-guard array update).
- [ ] Signed-in and signed-out navigation verified.
- [ ] Mobile 375px & 393px; desktop 1440px.
- [ ] No new dependency, migration, table or persisted state.

---

## 17. Unresolved technical decisions

Each has a default so implementation never blocks.

| # | Question | Default |
|---|---|---|
| D1 | Reuse `listCompletedExerciseOccurrences(…,1)` or add a dedicated presence port method? | **Reuse**; escalate only on measurable cost |
| D2 | Which `lucide-react` icon for `Progress`? | First available of `TrendingUp`/`ChartLineIncreasing`/`Activity`; **verify by import** |
| D3 | Signed-out mobile header: which layout keeps wordmark + public nav + `Sign in` within h64 at 375px? | Compact public nav; if crowding, rely on page-content catalog links. Flag for product sign-off |
| D4 | Is `/history` reachable on mobile after S3/S4? | Verify; add one dashboard link if not, never a nav change |
| D5 | Delete `LogoutButton.tsx` or only its landing usage? | Remove usage; delete file only if no other consumer |
| D6 | Does `(auth)` need its own `error.tsx`? | Yes — login/register call `getCurrentUser()` |
| D7 | Exact loading copy per route | Short factual labels, no digits, reviewed with S6 docs |

**Stop conditions.** This plan authorizes no code change. Implementation begins only after explicit approval, slice by slice per §13. Any deviation — especially a conflict with an M8–M18 semantic — is **reported, never silently applied**.
