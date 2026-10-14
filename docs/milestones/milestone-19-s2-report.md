# Milestone 19 — Slice 2 Implementation Report

**Slice:** S2 — Loading State Foundation
**Branch:** `feat/m19-s2-loading-states`
**Scope:** S2 only. S1, S3–S6 remain untouched. No domain/application/infrastructure
logic, schema, navigation, or M8–M18 semantics were modified.

## 1. Objective

Give the heaviest private routes an immediate, stable, non-fabricated loading
frame while the route awaits its server-rendered content. The frame reuses the
Fit40 design system, keeps layout shift minimal, is accessible, and can never
display workout data, metrics, dates or exercise names. Existing pages were not
redesigned. After the PR #25 review (four P2 threads), the streaming mechanism
changed from segment `loading.tsx` files to explicit per-page Suspense
boundaries so that authentication and resource validation run **before**
anything streams — see §9.

## 2. Routes and justification (M19 plan §7)

Each target route composes several sequential reads, so a slow render was
previously a blank screen. The exact read cost was verified in source:

| Route | Why it needs a loading state |
|-------|------------------------------|
| `/dashboard` | `dashboard/page.tsx:43` awaits program + enrollment + schedule + closure + history + insights. |
| `/progress` | `progress/page.tsx` composes two reads. |
| `/history` | `history-view.ts` runs three sequential reads. |
| `/history/exercises/[slug]` | four reads. |
| `/programs/[programSlug]` | enrollment + schedule + completion. |
| `.../session` | active workout. |

**Excluded:** the public catalog routes `/exercises` and `/programs` are already
cheap; latency UI there would be novelty, not value (M19 plan §7).

## 3. Files added

- `src/components/shared/RoutePlaceholder.tsx` — the **single** shared loading
  primitive. Props: `label`, optional `blocks` (Tailwind class strings),
  optional `className`. It renders exactly one `role="status"` polite live
  region carrying only the label text (visually `sr-only`, so it is not part of
  the geometry), and each requested block as an `aria-hidden` decorative surface
  using the proven `rounded-card border border-border bg-surface-2/50` treatment
  (`exercises/page.tsx:41`). No animation (nothing to reduce under
  `prefers-reduced-motion`). Server component: no `"use client"`, no hooks.
- **Per-page Suspense boundaries (post-review-fix; the six original
  `loading.tsx` files were deleted).** Each target page now returns
  `<Suspense fallback={<PageContainer><RoutePlaceholder …/></PageContainer>}>`
  around only its slow success-path content, with the identical geometry the
  loading.tsx used to show:
  - `dashboard/page.tsx` — header + summary-card stack, after auth + profile steering.
  - `progress/page.tsx` — heading + chart-height blocks, after auth.
  - `history/page.tsx` — heading + totals + list rows (first page), after auth.
  - `programs/[programSlug]/page.tsx` — program header + section cards in
    `pt-10 md:pt-10`, after parameter + existence validation (public route).
  - `.../session/page.tsx` — session header + workout content in
    `pb-6 md:pb-20`, after parameter validation, auth and the occurrence check.
  - `history/exercises/[slug]/page.tsx` — deliberately **no** boundary (see §9).

No skeleton framework, no new dependency, and exactly one shared primitive
(M19 plan §7.1).

## 4. Accessibility & layout decisions

- **One live region per frame.** `RoutePlaceholder` renders a single
  `role="status"` (implicitly `aria-live="polite"`) carrying the label only. No
  route renders a second competing live region.
- **Geometry is decorative.** Every block is `aria-hidden="true"`, so assistive
  tech announces the status and skips the placeholder shapes.
- **No fabricated value.** Blocks contain no text — no digit, date, metric, or
  exercise/workout name can appear while loading.
- **Layout stability.** Container classes mirror each page's real container
  (`PageContainer` defaults; `pt-10 md:pt-10` for program detail; `pb-6 md:pb-20`
  for session) so the transition to content does not shift.
- **Session frame intact.** The session placeholder renders no bottom bar of its
  own. `MobileTabBar` already hides itself on `/session` routes and the layout
  already reserves the finish-bar clearance, so the placeholder simply sits in
  the reserved frame (verified: no `aria-label="Primary"`, no fixed bottom bar).

## 5. Next.js streaming behavior (next@16.3.1)

Verified against a real `next build --webpack` + `next start` server:

- A `Suspense` boundary streams its fallback immediately while the wrapped
  server work continues; the resolved content replaces it in the same response
  (M19 plan §7.2). This is now the page-owned boundary, not a `loading.tsx`.
- **Status-critical work must precede the boundary.** Any `redirect()` or
  `notFound()` thrown after a boundary has flushed rides the stream with the
  status already committed as `200`; thrown before it, the response keeps its
  native `307`/`404`. This single rule drove the review-fix architecture (§9).
- **Auth redirect and `notFound()` — HTTP statuses (FIXED in the review round).**
  With a segment `loading.tsx` present, Next flushed the response head (`200`)
  and the fallback before the page's `requireUser()`/`notFound()` ran, so the
  redirect rode the stream (`NEXT_REDIRECT` digest + meta-refresh) and
  not-found routes answered `200 + noindex` instead of `404`. That mechanism
  has been removed: the six `loading.tsx` files are deleted and every
  status-critical check now runs **before** the page returns any JSX, with the
  slow success path behind an explicit per-page `Suspense` boundary. Verified
  against a production `next build --webpack` + `next start` server (§9.2):
  all five signed-out private targets return a native **307** with the correct
  `Location: /login?next=…`, and `/programs/<unknown>`, malformed exercise
  slugs and malformed session params return a native **404**. No response body
  leaks a streamed placeholder (`role="status"` count 0 in every 307/404 body).
  The earlier browser verification remains valid for the user-visible outcome
  (the login page is reached, with JavaScript enabled and disabled, and no
  unauthenticated private content is exposed).

No diagnostic routes, intentional crashes, or temporary files remain; the final
build listed all 18 app routes with **no probe routes**.

## 6. Tests

`tests/unit/components/shared/route-placeholder.test.ts` (43 tests) — real
`react-dom/server` renders of the actual components, following the repo's
`.test.ts` + `createElement` convention (no testing-library, no JSX in `.ts`):

- `RoutePlaceholder`: exactly one `role="status"`; all blocks `aria-hidden`;
  no digit in the rendered **text** (geometry digits live only in class
  attributes); one decorative surface per block; server component (leading-line
  directive check, not a fragile substring).
- Per route (all six): renders inside `PageContainer` (`max-w-[1120px]`); one
  `role="status"` with the route's label; aria-hidden geometry; no readable
  digit; substantive geometry present; composes `RoutePlaceholder` (a Next.js
  wiring fact not expressible as a rendered prop); server component.
- Session: renders no bottom bar.
- Excluded public catalog routes: `/exercises` and `/programs` have no
  `loading.tsx`.

The digit assertion strips tags before checking, because Tailwind utility digits
(`max-w-[1120px]`, `md:pt-10`) are geometry, not fabricated data — the contract
is that no **readable** value appears.

## 7. Verification

| Check | Command | Result |
|-------|---------|--------|
| Focused S2 tests | `npx vitest run tests/unit/components/shared/route-placeholder.test.ts` | **43 passed** |
| Typecheck | `npx tsc --noEmit` | **exit 0, 0 errors** |
| Lint | `npm run lint` | **exit 0** |
| Full unit suite | `npx vitest run` | **220 files / 3051 tests passed** |
| Architecture guards | (in full suite) | **passed** |
| Production build | `npx next build --webpack` | **exit 0, 18 routes, no probe routes** |
| Whitespace | `git diff --check` | **clean** |

A stale `.next/types` cache from the removed probes surfaced spurious TS errors
referencing `s2probe`/`s2control`; `rm -rf .next` + re-`tsc` confirmed a genuinely
clean typecheck. Turbopack build not claimed; `--webpack` is the documented
supported config.

## 8. Known limitations & risks

- **HTTP status regression from the original loading boundaries — RESOLVED.**
  The original six `loading.tsx` files committed `200` before auth/validation
  ran. They were deleted in the review-fix round; auth and validation now run
  before any JSX is returned and only slow success-path content streams
  (probe-verified native `307`/`404`, §9). No known status regression remains.
- **Evidence limits.** Loading-boundary behavior and the redirect/404/error
  interactions were verified by production HTTP probes against `next start`, not
  by browser interaction. No visual/manual verification at 375/393/1440px was
  performed.
- **Low:** placeholder heights approximate, not exactly match, loaded layout
  heights; minor shift is possible on some content.

## 9. S1 and S3–S6 untouched

No error boundaries (S1), auth-aware navigation (S3), mobile tab arrangement
(S4), exercise-history presence (S5), or UX polish (S6) were modified. No
database schema/migrations, domain/application/infrastructure logic, workout
progression, personal-record, scheduling, or historical-reporting code was
touched. No new dependency.
## 9. Review-fix round — pre-stream auth/validation (PR #25, four P2 threads)

### 9.1 What changed and why

The independent review confirmed two status regressions caused by the segment
boundaries, with four P2 threads (two on `dashboard/loading.tsx`, two on
`programs/[programSlug]/loading.tsx`):

1. signed-out private requests streamed the fallback before `requireUser()`,
   committing `200` without a `Location` header;
2. `/programs/<unknown>` streamed before `notFound()`, committing `200` with a
   not-found body instead of `404` — and the program boundary was inherited by
   the nested session route.

**Architecture chosen (smallest robust, reviewer-prescribed):** all six
`loading.tsx` files were deleted. Every status-critical await now runs in the
page **before it returns any JSX** (so, with no boundary in the route chain,
the framework emits a native `307`/`404`), and only the slow success path
streams behind an explicit page-owned `Suspense` boundary carrying the same
`RoutePlaceholder` fallback.

Per-route placement of the pre-stream checks:

| Route | Pre-stream (before any JSX) | Streamed (inside Suspense) |
|-------|------------------------------|-----------------------------|
| `/dashboard` | `requireUser` → redirect; profile-null → `/onboarding` | `buildDashboardView` |
| `/progress` | `requireUser` → redirect | the two composed reads |
| `/history` | `requireUser`; a tampered cursor is awaited **only when a cursor is present** (native 404) | first-page three-read view |
| `/history/exercises/[slug]` | malformed-slug `notFound`; `requireUser`; `await exerciseHistoryView` (covers `EXERCISE_NOT_FOUND`) | — none; no boundary |
| `/programs/[programSlug]` | malformed-slug + unknown-program `notFound` | enrollment / schedule / closure / follow-through / next-workout |
| session | malformed-params `notFound`; `requireUser`; `lookupScheduledWorkout` (covers the view builder's only `null` path; request-cached, shared with `generateMetadata`, so no extra read) | `buildActiveWorkoutView` |

Notes on the two deliberate asymmetries:

- **Exercise history has no Suspense boundary.** Its whole view is already
  awaited by `generateMetadata` (request-`cache()`d) before the head flushes
  when signed in, so a boundary could not fire before content; adding one would
  only reintroduce the post-flush `notFound()` hazard. Signed-out requests take
  the malformed-slug `notFound` or the auth redirect immediately.
- **History keeps a native 404 for tampered cursors** by awaiting the view
  before returning JSX *when a cursor param exists* (the only case that can be
  `INVALID_INPUT`); the heavy first page keeps its streamed placeholder.

The `(app)/layout.tsx` AUTH OWNERSHIP DECISION is untouched: no layout-level
auth was added, no route group was restructured, and no business logic moved.

### 9.2 Production probe matrix (evidence)

`npx next build --webpack` + `npx next start`, signed-out (no cookie), curl:

| Request | Status | Location / body |
|---------|--------|-----------------|
| `/dashboard` | **307** | `/login?next=%2Fdashboard` |
| `/progress` | **307** | `/login?next=%2Fprogress` |
| `/history` | **307** | `/login?next=%2Fhistory` |
| `/history?cursor=tampered` | **307** | `/login?next=%2Fhistory` (auth before cursor handling) |
| `/history/exercises/goblet-squat` | **307** | `/login?next=%2Fhistory%2Fexercises%2Fgoblet-squat` |
| `/history/exercises/Bad_Slug!` | **404** | not-found body |
| `/programs/definitely-unknown-program` | **404** | not-found body |
| `/programs/<slug>/weeks/1/workouts/1/session` | **307** | full encoded login path |
| `/programs/x/weeks/abc/workouts/1/session` | **404** | malformed week segment |
| `/programs/fit40-beginner-strength` (public) | **200** | real content (`<h1>Fit40 Beginner Strength</h1>`) |

Every `307`/`404` body was checked for leaked placeholders: `role="status"`
count **0**, "Loading …" labels **0**. The public `200` response contains the
resolved content; the fallback appears only inside React's inert
`<template>`/swap scaffolding, exactly as with the former `loading.tsx`.
### 9.3 Tests added/updated

- NEW `tests/unit/app/loading-boundary-status.test.ts` (20) — calls the real
  async pages with mocked services and asserts: auth/validation/not-found
  failures **reject before any JSX exists** (each with the "and the downstream
  read was never called" ordering evidence); authenticated success returns a
  `Suspense` boundary whose fallback is the shared placeholder (one live
  region, decorative geometry hidden, no readable digits); program detail and
  session stay pre-validated; the session fallback renders no bottom bar.
- `tests/unit/components/shared/route-placeholder.test.ts` — rewritten guards:
  zero `loading.tsx` anywhere under `src/app`; the five streaming pages compose
  `RoutePlaceholder` behind `Suspense`; exercise history deliberately has
  neither (documents the §9.1 decision).
- NEW `tests/unit/helpers/stream-render.ts` — unwraps the page-owned Suspense
  for the three existing page tests (`dashboard-page`, `progress-page`,
  `program-detail-page`), because React's sync renderer renders the fallback
  for async children. Those tests' assertions otherwise unchanged; the
  program-detail catalog-read count now reflects the page-validate + child-read
  call sites (one repository read in production via the request `cache()`).

### 9.4 Verification (this round)

| Check | Result |
|-------|--------|
| Focused S2 tests | 32 passed (20 status + 12 placeholder/guards) |
| Existing page tests | 39 passed (3 files) |
| Full unit suite | **221 files / 3040 tests passed** |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npx next build --webpack` | exit 0 |
| `git diff --check` | clean |

### 9.5 Remaining limitations

- The probe matrix is signed-out/public HTTP against `next start`; an
  authenticated runtime check was not performed (the repository ships no seeded
  user). Authenticated in-flight fallback visibility and soft-navigation
  timing therefore remain verified by unit-level ordering tests, not by
  browser observation.
- Crawler indexing outcomes are not verified (status codes are).
- Placeholder heights approximate the loaded layout; minor shift is still
  possible on some content.
