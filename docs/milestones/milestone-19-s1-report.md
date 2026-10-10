# Milestone 19 — Slice 1 Implementation Report

**Slice:** S1 — Error Boundary Foundation
**Branch:** `feat/m19-s1-error-boundaries`
**Scope:** S1 only. S2–S6 remain untouched.

## 1. Objective

Give Fit40 recoverable, user-friendly error states for unexpected rendering
failures while preserving every existing failure contract: authentication
redirects stay redirects, `notFound()` stays a 404, and expected
domain/application "unavailable" states are never replaced by a generic error.

## 2. Verified Next.js error-boundary behavior (next@16.3.1)

Correction 3 required evidence, not assumption. Isolated probe routes were
built, exercised against a real `next build` + `next start` server, and then
fully removed. Findings (recorded before writing the final boundaries):

| Case | Verified behavior |
|------|-------------------|
| Child **page** throws | The segment's own `error.tsx` catches it (flight payload references `.../error`). |
| Segment's **own `layout.tsx`** throws | The segment's own `error.tsx` does **NOT** catch it; it propagates to the parent. Confirms **a boundary never covers its own layout.** |
| Root layout throws | Only `global-error.tsx` can catch it. |
| `redirect()` / `requireUser()` | HTTP **307** to `/login?next=…` — a navigation; never intercepted by a boundary. |
| `notFound()` | HTTP **404** via the `/_not-found` route; never an error boundary. |
| Expected typed app error | Rendered by its own view state; never reaches a boundary. |
| `reset()` recovery | Re-renders the failed segment. |
| Internal-detail leak | **0** occurrences of the thrown message / `Error:` / stack in the streamed payload; Next.js sends a **digest**, not the message. |

`ErrorInfo` in 16.3.1 is `{ error: unknown; reset: () => void; retry: () => void }`.
Boundaries are typed `{ error: Error & { digest?: string }; reset: () => void }`
and use `reset()` for recovery. Type generation (`next-types-plugin`) validates
only `page`/`layout`/`generateMetadata`/`generateViewport`/`generateStaticParams`
— not `error.tsx`/`global-error.tsx` props — so the boundary signatures do not
affect the build's type gate.

## 3. Files added

- `src/components/shared/ErrorState.tsx` — presentational, dependency-free
  recoverable-error card. Geometry mirrors `EmptyState` (`rounded-card`,
  `border-border`, `p-10`, centered copy). It renders only caller-supplied
  `title`/`body`/`action` and never a raw `Error`, so internal messages,
  stack traces, SQL or digests cannot leak through it.
- `src/app/(app)/error.tsx` — Client Component boundary for the mixed
  public/private application routes. Logs via `useEffect`; renders `ErrorState`
  + `Button` (`Try again` → `reset()`).
- `src/app/(auth)/error.tsx` — Client Component boundary for login/register.
- `src/app/global-error.tsx` — root-level boundary; the only boundary that
  catches root-layout failures. Renders its own `<html>`/`<body>` with plain
  inline styles (Tailwind/design tokens are unavailable when it renders) and a
  44px `Try again` button.

## 4. Architectural decisions

- **Three boundaries, not one.** Because a boundary cannot catch its own
  layout, the route-group boundaries handle child-page failures and
  `global-error.tsx` is mandatory for root-layout failures. Placing only
  `(app)/error.tsx` would have left root-layout failures unprotected.
- **Privacy by construction.** No boundary ever passes the raw `error` into a
  rendered node. `ErrorState` has no error prop; boundaries log and then render
  fixed copy.
- **No new dependency / abstraction.** `ErrorState` reuses existing
  `EmptyState` tokens and the existing `Button`. No client-primitive import is
  added inside `ErrorState` itself, keeping it safe to render from any boundary.
- **No contract changes.** Nothing in Domain/Application/Infrastructure changed;
  `unavailable` view states, `redirect()` and `notFound()` are untouched.

## 5. Tests added

- `tests/unit/components/shared/error-state.test.ts` (16 tests) — behavioral
  render (jsdom + `react-dom/client` + `act`, matching repo convention):
  renders title/body/action; omits optional parts; `role="alert"`; renders only
  fixed copy (a sentinel thrown message never appears); global-error document
  shell verified via `react-dom/server` `renderToStaticMarkup` (own
  `<html>`/`<body>`); reset action wired.
- `tests/unit/architecture/error-boundaries.test.ts` (6 tests) — source-scan
  guard, matching the existing architecture-guard idiom: `global-error.tsx`
  is a client component rendering `<html>`/`<body>`; the `(app)` and `(auth)`
  boundaries are client components rendering `ErrorState` and wiring `reset`;
  no boundary renders `error.message`/stack text; no `any`/`as any`/`@ts-ignore`.

## 6. Verification (exact commands and results)

| Check | Command | Result |
|-------|---------|--------|
| Focused S1 tests | `npx vitest run tests/unit/components/shared/error-state.test.ts tests/unit/architecture/error-boundaries.test.ts` | **22 passed** |
| Typecheck | `npx tsc --noEmit` | **exit 0, 0 errors** |
| Lint | `npm run lint` | **exit 0** |
| Full unit suite | `npx vitest run` | **218 files / 2991 tests passed** (baseline 216/2969 → +2 files, +22 tests) |
| Production build | `npx next build --webpack` | **exit 0, 13 static pages, no probe routes** |

A stale `.next/types` cache produced spurious TS errors referencing the removed
probe routes; `rm -rf .next` and re-running `tsc` confirmed a genuinely clean
typecheck. `.next/` is git-ignored (`.gitignore:17`).

## 7. Risks and remaining items

- **Low:** boundaries log via `console.error` only; no external error-reporting
  service is configured (matches existing project convention). Wiring a reporter
  is out of S1 scope.
- **Low:** `global-error.tsx` intentionally uses inline styles, so it will not
  visually match the app theme — acceptable, since it only renders when the app
  shell/styles have already failed.
- **Verified, not assumed:** manual browser behavior for redirect/404/leak was
  confirmed against a real `next start` server during the probe phase (§2);
  the final UI itself is covered by unit/component tests, not by a manual
  click-through of the shipped pages.

## 8. S2–S6 untouched

No loading states (S2), navigation (S3/S4), exercise-history presence (S5), or
UX polish (S6) were modified. No database schema/migrations, domain logic,
progression, scheduling, personal-record, or historical-reporting code was
touched. No new dependency was added.
