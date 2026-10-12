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
redesigned; only a loading boundary was added beside each.

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
- Six `loading.tsx` files, one per target route, each composing
  `RoutePlaceholder` inside the existing `PageContainer` with route-appropriate
  geometry:
  - `src/app/(app)/dashboard/loading.tsx` — header + summary-card stack.
  - `src/app/(app)/progress/loading.tsx` — heading + chart-height blocks.
  - `src/app/(app)/history/loading.tsx` — heading + totals + list rows.
  - `src/app/(app)/history/exercises/[slug]/loading.tsx` — breadcrumb + trend + rows.
  - `src/app/(app)/programs/[programSlug]/loading.tsx` — program header + section
    cards, in the page's own `pt-10 md:pt-10` container.
  - `src/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/loading.tsx`
    — session header + workout content, in the page's `pb-6 md:pb-20` container.

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

## 5. Next.js loading-boundary behavior (next@16.3.1)

Verified against a real `next build --webpack` + `next start` server using
isolated probe routes (now removed):

- `loading.tsx` wraps its segment in a Suspense boundary; the fallback streams
  immediately while the segment's server work continues (M19 plan §7.2).
- **Deepest matching boundary wins.** `/history → /history/exercises/[slug]`
  resolves the exercise placeholder; `/dashboard → /programs/x` the program one.
  The nested routes each carry their own `loading.tsx`.
- **Auth redirect — documented tradeoff.** With a `loading.tsx` present, the
  route-group layout resolves and Next flushes `200 + fallback` before the
  page's `requireUser()` runs; the redirect then rides the stream
  (`NEXT_REDIRECT` digest + meta-refresh) instead of a native `307`. Without a
  fallback there is nothing to flush, so the redirect throws first as a native
  `307`. The redirect **still functions** in both cases (both mechanisms are
  emitted). Correcting this to a native redirect would require hoisting the auth
  guard above the loading boundary — i.e. changing `(app)/layout.tsx`'s mixed
  public/private design — which is explicitly out of S2 scope. Recorded as a
  known limitation (§8), not silently accepted as ideal.
- `notFound()` and the S1 error boundaries remain reachable through the same
  segments; the probe confirmed a 404 body and a 500 error state respectively
  were unaffected by adding the fallback.

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

- **Auth-redirect status change (documented, not fixed).** Signed-out cold
  navigation to a target route now returns `200 + streamed fallback +`
  `NEXT_REDIRECT`/meta-refresh instead of a native `307` (§5). The redirect is
  preserved and functional. A native-redirect fix requires moving the auth guard
  above the loading boundary, which changes `(app)/layout.tsx`'s deliberately
  mixed public/private design — out of S2 scope.
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
