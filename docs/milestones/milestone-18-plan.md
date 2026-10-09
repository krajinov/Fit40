# Milestone 18 Plan — Training Progress & Long-Horizon Trends

Implementation plan for M18. The **semantic authority is
[`docs/training-progress.md`](../training-progress.md)** (approved semantic
lock): this plan never restates or reinterprets metric rules — every rule,
formula, label and acceptance dataset referenced here resolves to that
document. Where this plan and the memo appear to disagree, the memo wins.

This is the first file under `docs/milestones/` and establishes the
convention: one plan per milestone, sliced for independent verification, each
slice with a single commit boundary (matching the "Commit chain (milestone_N)"
sections of the canonical docs).

**Status:** planning only — approved for review, not yet implemented.

## Global verification commands

| Level | Command |
|---|---|
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test` |
| Integration tests (real PostgreSQL) | `pnpm test:integration` |
| Production build | `pnpm build` |

Full-milestone gate (Slice 9): all five green on one commit.

## Global constraints (every slice)

- Reuse M12/M13 Domain rules verbatim (`calculateSessionMetrics`,
  `resolveOccurrenceWorkingLoad`, `extractRecordCandidates`,
  `resolveRecordEvents`, `findBestValuesBefore`, `findCurrentPersonalBests`,
  `training-week.ts` windows); **no change to M8/M12/M14/M16/M17
  semantics**.
- User-global completed history only: detached sessions count; performed
  ExerciseId attribution; skipped and not-performed occurrences contribute
  nothing.
- **No new tables, no migrations, no persisted analytics state** — read-time
  derivation only.
- No N+1: a constant number of batched statements per read; the PR-event
  candidate set is **never** capped (§8.2 of the memo) — bound statements,
  not candidates.
- Fixed 13-week UTC horizon (`PROGRESS_HORIZON_WEEK_COUNT = 13`); one
  caller-supplied request clock per request; no `Date.now()` below
  presentation; no browser clock.
- Truthful empty / sparse / degraded states per memo §10; presentation copy
  per memo §11.
- Design-system components only; text-first accessible charts (SVG as
  decoration, ≥2 points before a line, visible zero floors).
- Layering: Presentation → Application → Domain; Infrastructure implements
  Application ports; no business rules in React components, Server Actions,
  or SQL adapters; no `any`/casts/non-null assertions.
- No slice may leave an unresolved interface or broken wiring: every slice
  compiles, passes its tests, and ships independently.

## Slice sequence

| # | Slice | Depends on | Commit boundary |
|---|---|---|---|
| 1 | Domain period aggregation (activity, volume presence, average) | — | `feat(domain): progress period aggregation and workout average (M18 Slice 1)` |
| 2 | Windowed activity read model with external-load volume | 1 | `feat(progress): windowed session activity read with external-load volume (M18 Slice 2)` |
| 3 | Approved M13 volume label/presence alignment | — | `feat(history): align volume badges to kg × reps and presence semantics (M18 Slice 3)` |
| 4 | Progress surface v1 — route, nav, activity/volume, period summary | 2, 3 | `feat(progress): Progress surface with 13-week activity and external-load trends (M18 Slice 4)` |
| 5 | Period PR-event read model (exact count, newest 10, still-stands) | 2 | `feat(progress): period personal-record event read model (M18 Slice 5)` |
| 6 | Progress PR timeline UI + summary PR fragment | 4, 5 | `feat(progress): personal-best timeline on the Progress surface (M18 Slice 6)` |
| 7 | Exercise-history PR markers | 5 | `feat(history): personal-record markers on the exercise trend (M18 Slice 7)` |
| 8 | First-vs-latest working-load comparison | 2, 7 | `feat(history): period first-vs-latest working-load context (M18 Slice 8)` |
| 9 | Architecture guards, docs, full regression | 1–8 | `docs(m18): canonical docs, screen notes and regression guards` |

Sequencing rationale: Domain before reads (S1→S2); the approved label
alignment (S3) is independent and lands before any new volume UI reuses
`formatHistoryVolume`; PR work (S5) is independent of the surface so the read
model is exact before UI renders it; S7 and S8 both extend
`GetExerciseHistoryUseCase` and are serialized to avoid file conflicts.

---

## Slice 1 — Domain period aggregation

**Goal & user-visible outcome.** Pure Domain rules that make the Progress
surface's numbers computable: 13-week week bucketing with external-load
presence, period totals, and the §4.5 anchored average. Not yet user-visible;
the outcome is a tested Domain service every later slice reads through.

**Files likely to change.**
- NEW `src/domain/services/training-progress.ts`
- NEW `tests/unit/domain/services/training-progress.test.ts`

**Domain responsibilities.**
- Structural activity-row input (like `CompletedSessionActivity`):
  `{ completedAt: Date; loggedSets: number; externalLoadVolume: number | null }`
  where `null` = the session contained no rep set with `weightKg !== null`
  (presence semantics, §6.3), a number (including `0`) = the session's
  `calculateSessionMetrics().volume`.
- `summarizeProgressWeeks(rows, windows)` — buckets rows into the supplied
  `TrainingWeekWindow`s by `completedAt` with the `[start, end)` rule;
  per-week: `completedWorkouts`, `loggedSets`, and
  `externalLoad: { volumeKgReps: number } | null` (null iff every in-week row
  is null). Mirrors `summarizeTrainingWeeks` behavior for workouts/sets —
  zero weeks included, out-of-span rows ignored, never mutates inputs.
- `summarizeProgressPeriod(summaries)` — totals across all windows: workouts,
  sets, and period `externalLoad` (null iff every week is null), per §4.4.
- `resolveAverageWorkoutsPerWeek(summaries)` — §4.5 exactly: considers only
  the first 12 windows (the last supplied window is the current partial week
  by `listRecentTrainingWeekWindows` contract); numerator = their workout
  sum; anchor = 0-based index of the first window among them holding ≥1
  workout; denominator = `12 − anchor`; interior/trailing zero weeks count;
  returns `{ workoutsPerWeek, denominatorWeeks } | null` (`null` when no
  workouts exist in the completed weeks — never `0`).
- Explicit types and discriminated results per `AGENTS.md` (no `any`,
  explicit return types).

**Application responsibilities.** None in this slice (no use case yet).

**Infrastructure responsibilities.** None.

**Presentation responsibilities.** None.

**Tests & acceptance criteria.**
- Unit: acceptance datasets **A** (27 ÷ 12 → 2.25), **N** (15 ÷ 5 → 3.0),
  **P** (24 ÷ 12 → 2), **O** (first workout in current week → null),
  **B/C** volume presence per week and period (null vs genuine `0`), zero-week
  bucketing, boundary inclusivity (`completedAt` exactly at `weekStart`).
- Parity drift-guard: `summarizeProgressWeeks` workouts/sets equal
  `summarizeTrainingWeeks` output for the same rows/windows (idiom:
  `schedule-follow-through-parity.test.ts`).
- Input immutability; window-order preserved (oldest → newest).

**Depends on.** None.

**Non-goals.** No new week-window arithmetic (consume `training-week.ts`);
no formatting/labels; no knowledge of repositories, DTOs, or the number 13
(the caller supplies `windows`); no PR or working-load logic.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test`.

**Commit boundary.** `feat(domain): progress period aggregation and workout average (M18 Slice 1)`.

---

## Slice 2 — Windowed activity read model with external-load volume

**Goal & user-visible outcome.** A complete, wired read model:
`GetTrainingProgressActivityUseCase` returning per-week workouts/sets/volume,
period totals, and the §4.5 average over the fixed 13-week horizon. Not yet
rendered; user-visible when Slice 4 surfaces it.

**Files likely to change.**
- `src/application/ports/training-history-repository.ts` (new port method)
- NEW `src/application/dto/training-progress.ts` (DTOs, mapper,
  `PROGRESS_HORIZON_WEEK_COUNT = 13`)
- NEW `src/application/use-cases/get-training-progress-activity.ts`
- `src/infrastructure/database/repositories/drizzle-training-history-repository.ts`
- InMemory/fake doubles implementing `TrainingHistoryRepository` (existing
  unit-test fake patterns)
- NEW `tests/unit/application/use-cases/get-training-progress-activity.test.ts`
- NEW `tests/integration/database/training-progress-activity.test.ts`

**Domain responsibilities.** Consume Slice 1's services and
`listRecentTrainingWeekWindows(now, PROGRESS_HORIZON_WEEK_COUNT)` from
`training-week.ts`; no new Domain logic in this slice.

**Application responsibilities.**
- `GetTrainingProgressActivityUseCase.execute({ userId, now })`: validate
  userId (M13 pattern); build the 13 windows from the caller-supplied `now`;
  one port read `since = oldest weekStart` (inclusive); Domain summaries →
  DTO. Error contract: `INVALID_INPUT` only. The use case owns the horizon
  constant's use — no `Date.now()` anywhere.

**Infrastructure responsibilities.**
- New port method `listProgressSessionActivity(userId, since)` returning
  `{ sessionId, completedAt, loggedSets, externalLoadVolume: number | null }`
  for completed sessions with `completedAt >= since`: user-scoped,
  detached-inclusive, completed-only (the `listCompletedSessionActivity`
  contract family), plus a **conditional-aggregation projection** of external
  load per session (`SUM(reps × weightKg)` over rep sets with non-null
  `weightKg`, together with an eligible-set existence flag that distinguishes
  a genuine `0` from `null`).
- Bounded statements: a constant number (sessions + one batched set
  aggregation), never per-session queries. The user + `completed_at` range
  scan is served by the **existing** `workout_sessions_user_completed_idx`
  (the M13 activity read's own access pattern) — no new index, no migration.

**Presentation responsibilities.** None (Slice 4).

**Tests & acceptance criteria.**
- Integration (real PostgreSQL): **oracle comparison** — per-session
  `externalLoadVolume` equals `calculateSessionMetrics(...).volume` over the
  hydrated session (dataset C: genuine `0`; dataset B: `null`); detached
  sessions count (K); `since`-inclusive boundary (M); in-progress sessions
  excluded; dataset **L** — a `not_performed_workouts` row and a skipped
  exercise inside an otherwise completed session change no metric (the
  workout counts; only logged sets do); statement-count bound via the
  debug-hook counter pattern (no N+1).
- Unit: use case with fake ports — clock pass-through (13 windows,
  oldest → newest, last = current), invalid userId → `INVALID_INPUT`, empty
  history → truthful empty DTO (13 zero weeks, `null` average — never a
  fabricated value).

**Depends on.** Slice 1.

**Non-goals.** No PR reads; no per-week volume in SQL (week bucketing stays
in Domain); no change to `listCompletedSessionActivity` or any M13 read; no
presentation; no schema change.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`.

**Commit boundary.** `feat(progress): windowed session activity read with external-load volume (M18 Slice 2)`.

---

## Slice 3 — Approved M13 volume label/presence alignment

**Goal & user-visible outcome.** The explicitly approved §6.4 change: every
existing volume badge says **`kg × reps`** (not "kg") and distinguishes a
genuine `0 kg × reps` session from a session with no eligible loaded sets.
User-visible on Training History and completed-session detail immediately.

**Files likely to change.**
- `src/features/history/history-labels.ts` (`formatHistoryVolume` →
  "kg × reps")
- `src/features/history/history-view.ts` (badge presence via eligibility)
- `src/features/history/completed-session-view.ts` (same)
- `src/application/dto/workout-session.ts` (metrics DTO gains an additive
  `hasExternalLoad` fact, or the mapper derives presence — computed in the
  application DTO mapper from the serialized sets, **never in a React
  component**)
- `src/application/dto/training-history.ts`, `src/application/dto/completed-session.ts`
  (mappers only if presence crosses the boundary there)
- `tests/unit/features/history/history-labels.test.ts`,
  `tests/unit/features/history/history-view.test.ts` (+ completed-session view
  tests) — updated expectations

**Domain responsibilities.** None — `calculateSessionMetrics` and every
repository/SQL path are preserved byte-for-byte (§6.4 approval condition).

**Application responsibilities.** Derive per-session external-load eligibility
(≥1 rep set with `weightKg !== null`) alongside the existing volume metric in
the DTO mappers; both facts cross the boundary explicitly.

**Infrastructure responsibilities.** None.

**Presentation responsibilities.**
- `formatHistoryVolume` renders `"1,240 kg × reps"` (integer, en-US grouping,
  unchanged rounding).
- History and completed-session views show the badge iff eligibility holds; a
  `0`-with-eligibility session renders `"0 kg × reps"`; bodyweight/duration-
  only sessions render no badge (replacing the current `volume > 0`
  suppression).

**Tests & acceptance criteria.**
- Unit: label tests updated (`760 → "760 kg × reps"` etc.); presence matrix —
  loaded sets > 0 volume → badge; all-`0 kg` → `"0 kg × reps"`; bodyweight-
  only → no badge; duration-only → no badge; reps-only-with-null-weight → no
  badge (datasets B/C at session scope).
- No test asserts a domain/SQL change (there is none).

**Depends on.** None (independent; scheduled before Slice 4 so new surfaces
reuse the aligned helper).

**Non-goals.** No changes to `session-metrics.ts`; no changes to any
repository; no other M13 copy, layout, or behavior changes; no changes to
reps/duration badges.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test`.

**Commit boundary.** `feat(history): align volume badges to kg × reps and presence semantics (M18 Slice 3)`.

---

## Slice 4 — Progress surface v1: route, nav, activity & volume, period summary

**Goal & user-visible outcome.** The `/progress` page exists and answers
questions 1, 2, and part of 5: 13-week weekly workouts/sets trend, weekly
external-load trend, period totals, factual period summary (workouts, sets,
volume, average) with truthful empty/sparse/degraded states. Desktop nav
gains "Progress"; dashboard gains a link only.

**Files likely to change.**
- NEW `src/app/(app)/progress/page.tsx` (thin: `requireUser`, one request
  clock, compose view, render)
- NEW `src/features/progress/` — `services.ts` (composition root),
  `progress-view.ts` (pure DTO → view mapping + label formatting),
  `progress-labels.ts`, `components/` (e.g. `ProgressScreen.tsx`,
  `WeeklyActivityChart.tsx`, `ExternalLoadChart.tsx`,
  `PeriodSummaryCard.tsx` — each ≤ ~150 lines)
- `src/components/shared/AppNavLinks.tsx` (add `Progress` link — desktop only)
- `src/app/(app)/dashboard/page.tsx` (one `<Link href="/progress">` only)
- NEW `tests/unit/features/progress/progress-view.test.ts`,
  chart/component tests, NEW `tests/unit/app/progress-page.test.ts`
- Possibly `tests/unit/components/` nav tests if nav assertions exist

**Domain responsibilities.** None new (S1 services already exist).

**Application responsibilities.** Reuse
`GetTrainingProgressActivityUseCase` (S2); the view assembler follows the
M13 dashboard pattern — each card a `loaded | unavailable` discriminated
union so a failed read degrades that card only.

**Infrastructure responsibilities.** None.

**Presentation responsibilities.**
- 13 week rows always render (visible zero floors); current week labeled
  "This week" with `aria-current="date"`; week/date labels component-based
  (UTC, never raw ISO) reusing history label helpers.
- Charts: text-first — every point an accessible text value; SVG line/bars as
  `aria-hidden` decoration (idiom: `ExerciseHistoryTrend`,
  `WeeklyActivityStrip`); volume points render only where present, absence
  renders an honest note ("No loaded sets in the last 13 weeks."), never `0`.
- Period summary: factual fragments only (memo §4.4/§11 vocabulary); the
  average line uses the locked basis wording; PR fragment is **not** rendered
  until Slice 6.
- States per memo §10: no completed workouts → 13 zero weeks + empty copy;
  `unavailable` → "Couldn't load …" per card; no fabricated zeros.
- Components are pure renderers; no business rules, no repositories.

**Tests & acceptance criteria.**
- View-mapping unit tests: DTO fixtures → exact label strings (datasets A/B/C
  at display level); volume absence vs `"0 kg × reps"`; average present/null;
  "This week" marking; rendered-copy vocabulary assertions (no "adherence",
  "streak", "missed", "failed", "on track" in rendered output).
- Page test: `requireUser` redirect; single clock passed; dashboard renders
  the link and **no new read**.
- Source-scan guards (nav contains `/progress`, `MobileTabBar` stays exactly
  4 tabs, import boundaries, source vocabulary) are owned **solely by
  Slice 9** — no duplicate architecture guards in this slice.

**Depends on.** Slice 2 (activity read), Slice 3 (aligned volume label).

**Non-goals.** PR timeline (S6); exercise-history changes (S7/S8); fifth
mobile tab; dashboard analytics; horizon selector; any program/run-scoped
data.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Commit boundary.** `feat(progress): Progress surface with 13-week activity and external-load trends (M18 Slice 4)`.

---

## Slice 5 — Period PR-event read model (exact count, newest 10, still-stands)

**Goal & user-visible outcome.** The exact historical PR-event answer for the
13-week period as a wired read model: exact event count (never truncated),
newest-10 display list with still-stands/surpassed context and catalog names.
Not yet rendered (Slice 6).

**Files likely to change.**
- `src/application/ports/training-history-repository.ts` (new range-read
  method — **recommended home**: the read-side port whose charter is
  user-global history, whose `listCompletedSessions` already returns
  hydrated entries, and whose user + `completed_at` access pattern the
  existing `workout_sessions_user_completed_idx` serves.
  `WorkoutSessionRepository` is a fallback only with a written rationale —
  one home, never both; the read returns hydrated completed sessions for a
  `since` range with bounded hydration)
- NEW `src/application/dto/training-progress.ts` (extend: record-event DTOs,
  `PROGRESS_RECORD_EVENT_LIMIT = 10`, mapper helpers)
- NEW `src/application/use-cases/get-training-progress-record-events.ts`
- `src/infrastructure/database/repositories/drizzle-training-history-repository.ts`
  (or the workout-session Drizzle repository, whichever hosts the port
  method)
- InMemory/fake doubles for the touched port
- NEW `tests/unit/application/use-cases/get-training-progress-record-events.test.ts`
- NEW `tests/integration/database/progress-record-events.test.ts`

**Domain responsibilities.** Reuse verbatim: `extractRecordCandidates`,
`resolveRecordEvents`, `comparePerformancePositions` — no new Domain logic.
Still-stands comparison uses position identity `(sessionId, exerciseOrder,
setNumber)` against `findCurrentPersonalBests` results (memo §8.5).

**Application responsibilities.**
- `GetTrainingProgressRecordEventsUseCase.execute({ userId, now })`:
  - horizon range: `since = listRecentTrainingWeekWindows(now, 13)[0].weekStart`
    (candidate origin; no upper bound needed — memo §5.3);
  - one bounded hydration read of completed sessions in range (ascending
    `(completedAt, startedAt, id)` like M14's enrollment read), user-scoped
    and detached-inclusive;
  - **zero candidates → return early without issuing `findBestValuesBefore`**
    (M14 pattern);
  - one batched `findBestValuesBefore(userId, allCandidates)` — **every**
    candidate, no cap (memo §8.2);
  - `resolveRecordEvents` → exact `recordEventCount`;
  - newest 10 by `comparePerformancePositions` (cap after count);
  - one batched `findCurrentPersonalBests` over the distinct exercises of the
    displayed events (skipped when nothing renders) →
    `stillStanding` / `sinceSurpassed` per row;
  - one batched catalog read for names (skipped when nothing renders;
    unresolved ids omit rows, never change the count).
- Memory/query notes: candidates grow with the horizon's data volume only
  (13 weeks), one batched round trip for priors (the port is proven at
  ~297k sets); no per-event/per-exercise queries ever.

**Infrastructure responsibilities.** Implement the bounded range hydration:
sessions + batched exercise logs + batched set logs (constant statement
count); no ordering assumptions beyond the documented contract; no schema
work.

**Presentation responsibilities.** None (Slice 6).

**Tests & acceptance criteria.**
- Unit: dataset **D** (count 2; W6 "Since surpassed", W9 "Still your best";
  equal set not an event; out-of-horizon prior gates W6), **E** (first
  exposure → `previousBest: null`), count-vs-cap (12 events → count 12,
  list 10), catalog-unresolved → row omitted/count unchanged, zero-candidate
  early return (no port call), invalid userId, order-independence (shuffled
  candidates resolve identically).
- Integration: real-PostgreSQL round trip with history **older than the
  horizon** producing `bestBefore` from outside the range (candidate origin
  vs. user-global priors); detached sessions contribute candidates; sessions
  outside the range are not candidates; bounded statement count (debug-hook
  counter); cross-check counts against the `foldPersonalRecords` oracle over
  the same fixture (M14 idiom).

**Depends on.** Slice 2 (horizon constant / `dto/training-progress.ts`).

**Non-goals.** No changes to any M12 port contract or Domain rule; no PR
detection in SQL; no persistence; no UI; no `findCurrentPersonalBestsSetBetween`
(that stays dashboard-only); no run/enrollment scoping.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`.

**Commit boundary.** `feat(progress): period personal-record event read model (M18 Slice 5)`.

---

## Slice 6 — Progress PR timeline UI + summary PR fragment

**Goal & user-visible outcome.** Question 3 answered on `/progress`: the
period's exact "personal bests set" count, the newest-10 event timeline with
per-row "first time"/previous value and "Still your best"/"Since surpassed"
context, session links, and truthful empty/degraded states.

**Files likely to change.**
- `src/features/progress/progress-view.ts`, `progress-labels.ts` (extend)
- NEW `src/features/progress/components/PersonalBestTimeline.tsx`
  (count line, cap note when count > 10, rows; ≤ ~150 lines)
- `src/features/progress/components/PeriodSummaryCard.tsx` (PR fragment)
- `src/app/(app)/progress/page.tsx` (second read + independent degradation)
- `src/features/progress/services.ts` (register the use case)
- `tests/unit/features/progress/` — timeline view/component tests, summary
  tests; `tests/unit/app/progress-page.test.ts` (updated)

**Domain responsibilities.** None (S5 resolves everything).

**Application responsibilities.** Consume
`GetTrainingProgressRecordEventsUseCase` (S5) unchanged; view mapping treats
event state as data — never re-computes comparisons.

**Infrastructure responsibilities.** None.

**Presentation responsibilities.**
- Headline count from the exact `recordEventCount` (never the list length);
  cap note when `count > 10` (e.g. "Showing the 10 newest"); rows in
  **ascending position order (oldest → newest)** per memo §8.4.
- Metric labels/values via M12's shared formatter; units are kilograms, reps,
  or seconds per metric — never `kg × reps` (that unit belongs to volume
  only).
- Empty state ("Personal bests you set in the last 13 weeks will appear
  here."); `unavailable` state; catalog-unresolved rows already omitted by
  the DTO.
- Summary gains a "· n personal bests" fragment with locked vocabulary.
- Banned vocabulary per memo §11; no confetti/trophies (M12 ban).

**Tests & acceptance criteria.**
- Unit: count rendered from exact count with a 12-event fixture (list capped
  at 10 + cap note); both context states render (dataset D); "first time" vs
  previous value (E); empty and unavailable states; session links; banned-
  vocabulary assertions; page degrades the timeline independently of the
  activity cards (failed PR read → activity still renders).

**Depends on.** Slice 4 (surface), Slice 5 (read model).

**Non-goals.** Completion-moment notification/toast (M12 deferred, still
deferred); dashboard PR changes; exercise-history markers (S7); new PR
metrics (volume/e1RM/RPE records remain banned).

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Commit boundary.** `feat(progress): personal-best timeline on the Progress surface (M18 Slice 6)`.

---

## Slice 7 — Exercise-history PR markers

**Goal & user-visible outcome.** The exercise-history working-load trend
gains personal-record markers: a point is marked iff its occurrence contains
a resolved `max-load` event — with detection over **complete user-global
prior history** even though only the newest 50 occurrences are displayed
(memo §8.6).

**Files likely to change.**
- `src/application/ports/training-history-repository.ts` — additive
  `startedAt` on `CompletedExerciseOccurrence` (required to build the full
  `PerformancePosition` ladder; additive field, no semantic change)
- `src/application/use-cases/get-exercise-history.ts` (candidate extraction →
  batched `findBestValuesBefore` → `resolveRecordEvents` → marker set)
- `src/application/dto/exercise-history.ts` (marker DTO keyed by
  `(sessionId, exerciseOrder)`; `max-load` events only)
- `src/features/history/exercise-history-view.ts`,
  `src/features/history/components/ExerciseHistoryTrend.tsx` (marker
  rendering), possibly `ExerciseHistoryOccurrenceList.tsx`
- `src/infrastructure/database/repositories/drizzle-training-history-repository.ts`
  (populates the additive `startedAt`) + inline test fakes/fixtures updated
- `tests/unit/application/use-cases/get-exercise-history.test.ts`,
  `tests/unit/features/history/` (trend/view tests)
- NEW `tests/integration/database/exercise-history-markers.test.ts`

**Domain responsibilities.** Reuse `toRecordCandidate` semantics and
`resolveRecordEvents` verbatim; position assembly from read rows is
Application mapping using Domain primitives — no new Domain rules, no change
to M12 detection.

**Application responsibilities.**
- After the existing occurrence read: extract candidates for the displayed
  occurrences' sets (performed exercise id = the resolved exercise), build
  positions from `(completedAt, startedAt, sessionId, exerciseOrder,
  setNumber)`, **one batched `findBestValuesBefore` over all of them** (skip
  when zero), resolve events, project markers for `max-load` only.
- Existing reads (occurrences, current PBs) unchanged; exactly one extra
  statement total.

**Infrastructure responsibilities.** Additive `startedAt` projection on the
existing occurrence query (no schema change, no extra statement).

**Presentation responsibilities.**
- `ExerciseHistoryTrend` marks matching points; each marker gets accessible
  text (e.g. "Personal best: 32.5 kg") in the existing text list — the SVG
  dot stays decoration; marker copy never claims the plotted point value
  equals the record (memo §8.6 meaning).
- Legend/wording follows M12 bans (no trophies, nothing hover-only).

**Tests & acceptance criteria.**
- Unit: dataset **Q** semantics with a fake `findBestValuesBefore` (27.5 → no
  marker; equal 30 → no marker; 32.5 → marker); first exposure → marker;
  only `max-load` (bodyweight-rep/duration events never mark); marker keys on
  occurrence identity (duplicate occurrences stay distinct); dataset **J** —
  a substituted occurrence (performed id = the resolved exercise)
  contributes candidates and can carry a marker, the authored exercise
  receives nothing; zero-candidate
  skip; regression: trend shape and PB cards unchanged.
- Integration: real-PostgreSQL fixture where the prior best exists **outside
  the displayed window** — marker decisions match the `foldPersonalRecords`
  oracle; position construction correct across tied timestamps; bounded
  statement count.

**Depends on.** Slice 5 (candidate/position mapping idioms only — no shared
code requirement).

**Non-goals.** No change to `EXERCISE_HISTORY_OCCURRENCE_LIMIT`, the trend
shape, current PBs, or completion-session badges; no markers for
`max-bodyweight-reps`/`max-duration`; no all-time window redesign.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`.

**Commit boundary.** `feat(history): personal-record markers on the exercise trend (M18 Slice 7)`.

---

## Slice 8 — First-vs-latest working-load comparison

**Goal & user-visible outcome.** Question 4 answered on the exercise-history
screen: a period-scoped context line — "Working load in the last 13 weeks:
20 kg (Jun 2) → 22.5 kg (Sep 8)", with factual **increased / unchanged /
decreased** direction — plus the honest insufficient-data notes (memo §7).

**Files likely to change.**
- `src/application/ports/training-history-repository.ts` (new method:
  occurrences of one exercise completed `>= since`, bounded batched
  hydration, no artificial cap — the period must never be truncated by the
  50-occurrence display bound)
- `src/domain/services/occurrence-working-load.ts` (additive
  `resolveWorkingLoadComparison(occurrences)` — first/latest by the ladder,
  `null` below two eligible loaded occurrences)
- `src/application/use-cases/get-exercise-history.ts` (second occurrence
  read scoped to the horizon; wires comparison into the DTO)
- `src/application/dto/exercise-history.ts` (`comparison` field)
- `src/features/history/exercise-history-view.ts`,
  `src/features/history/components/` (context line under the trend)
- `src/app/(app)/history/exercises/[slug]/page.tsx` (captures the single
  request clock and threads it through `buildExerciseHistoryView`)
- `src/infrastructure/database/repositories/drizzle-training-history-repository.ts`
  (implements the `since` read) + inline test fakes/fixtures updated
- `tests/unit/domain/services/occurrence-working-load.test.ts` (extended),
  `tests/unit/application/use-cases/get-exercise-history.test.ts`,
  `tests/unit/features/history/` view tests
- NEW `tests/integration/database/exercise-occurrences-since.test.ts`

**Domain responsibilities.**
- `resolveWorkingLoadComparison`: filter to occurrences with ≥1 logged set
  and `resolveOccurrenceWorkingLoad(...).kind === 'external'`; order by the
  ladder (`completedAt`, `startedAt`, `sessionId`, `exerciseOrder` ascending);
  first = head, latest = last; equal → `{ direction: 'unchanged' }`;
  `< 2` eligible → `null`. Pure, no clock, no horizon knowledge.

**Application responsibilities.**
- `GetExerciseHistoryUseCase` additionally reads in-horizon occurrences
  (`since = listRecentTrainingWeekWindows(now, 13)[0].weekStart`, one clock
  supplied by the page) and maps `first`/`latest` with their `completedAt`
  dates into the DTO; comparison is `null` when the Domain returns `null` or
  no in-horizon occurrences exist.
- `GetExerciseHistoryInput` gains a required `now` (it is `{ userId, slug }`
  today) and `buildExerciseHistoryView` threads the page's single clock — a
  contained input-shape change: every caller updates in this slice's commit.

**Infrastructure responsibilities.** Implement the `since`-scoped occurrence
read with the same batched-hydrate discipline (constant statements, user-
scoped, completed-only, detached-inclusive, performed id unchanged).

**Presentation responsibilities.**
- Context line beneath the trend with both dates; direction word from the
  DTO (never computed in the view); the `< 2` note and the existing
  "no external load" note per memo §7.5/§7.6.
- No percentages, no e1RM, no coaching phrasing.

**Tests & acceptance criteria.**
- Unit (Domain): dataset **F** (20 → 22.5 increased), **G** (equal →
  unchanged), **H** (decreased), **I** (one point → null), all-unloaded →
  null, same-session duplicate occurrences tie-broken by `exerciseOrder`,
  mixed loaded/unloaded (unloaded ignored).
- Unit (use case/view): horizon `since` passed to the port; DTO direction
  rendered verbatim; note copy; PB cards and trend regression-untouched.
- Integration: `since`-inclusive boundary; occurrence outside horizon
  excluded from comparison but still present in the display window; detached
  session occurrences count; statement bound.

**Depends on.** Slice 2 (`PROGRESS_HORIZON_WEEK_COUNT`), Slice 7 (introduces
the `startedAt` field the comparison ladder consumes, and shares the
use-case/DTO files — serialized to avoid conflicts).

**Non-goals.** All-time first-vs-latest (deferred per memo §14); bodyweight/
duration comparisons; percentages; changes to the trend or the 50-window.

**Verification.** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`.

**Commit boundary.** `feat(history): period first-vs-latest working-load context (M18 Slice 8)`.

---

## Slice 9 — Architecture guards, documentation, full regression

**Goal & user-visible outcome.** No new features; the milestone is sealed:
guard tests pin M18's boundaries, canonical docs describe the shipped
surface, and the full verification gate is green.

**Files likely to change.**
- NEW `tests/unit/architecture/training-progress.test.ts`
- `README.md` (features, Main Application Areas table + `/progress`, Project
  Status)
- `docs/ui.md` (M18 screen notes: Progress surface, PR markers, comparison
  line, approved volume-label change — following the M15/M16/M17 note style)
- `docs/architecture.md` (M18 ownership section, following the M14–M17
  pattern)
- `docs/training-progress.md` only if a shipped deviation is discovered —
  deviations are **reported, never silently applied**

**Domain responsibilities.** None.

**Application responsibilities.** None.

**Infrastructure responsibilities.** None.

**Presentation responsibilities.** None.

**Tests & acceptance criteria.**
- Architecture guard tests (source-scan idiom of `tests/unit/architecture/`):
  - `src/features/progress/` imports neither ports nor infrastructure; view
    mappers never call repositories; no `Date.now()` in `src/application/`
    or `src/domain/`;
  - `AppNavLinks` contains `/progress`; `MobileTabBar` still has exactly 4
    tabs (no fifth tab);
  - banned vocabulary (adherence, streak, missed, failed, on-track,
    readiness, e1RM) absent from `src/features/progress/` and the history
    label helpers;
  - `formatHistoryVolume` emits `kg × reps`.
- **Acceptance walkthrough:** every dataset **A–Q** of the memo §13 matrix has
  a passing test reference listed in this plan (traceability check in the
  docs).
- Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm build`
  — all green on one commit (the M17 standard).

**Depends on.** Slices 1–8.

**Non-goals.** Any code change beyond guard tests and documentation fixes;
no refactors; no renaming; no scope additions discovered during polish.

**Verification.** All five commands above.

**Commit boundary.** `docs(m18): canonical docs, screen notes and regression guards`.

---

## Final verification plan (required test categories → where they live)

| Category | Where |
|---|---|
| Domain unit tests | S1 `training-progress.test.ts`, S8 `occurrence-working-load.test.ts` extension, parity drift-guard |
| Application use-case tests | S2 `get-training-progress-activity`, S5 `get-training-progress-record-events`, S7/S8 `get-exercise-history` extensions (fake ports) |
| Real PostgreSQL integration tests | S2 activity read, S5 range read + oracle, S7 markers oracle, S8 `since` read; statement-count discipline via debug-hook counters |
| Historical PR exactness tests | S5: count-vs-cap, still-stands/surpassed (D), first exposure (E), user-global priors outside horizon (D integration), `foldPersonalRecords` cross-check |
| Volume aggregation oracle | S2: SQL projection == `calculateSessionMetrics` (B/C/K) |
| UTC boundary tests | S1 (`weekStart` inclusivity), S2 (`since` inclusive), S8 (`since` inclusive); completion attribution (M) |
| Detached-session / substitution / settlement tests | S2 (K, L), S5 (K), S7 (J), S8 — detached + performed-id attribution; not-performed and skipped occurrences change no metric (L) |
| Empty / degraded-state tests | S2 empty DTO, S4/S6 view + page states, memo §10 rows |
| Architecture guard tests | S9 `tests/unit/architecture/training-progress.test.ts` + S4 nav/clock assertions |
| Typecheck / lint / unit / integration / build | Per-slice verification lines; full gate at S9 |

## Stop conditions (this document)

Planning only. No production code, schema, branch, commit, push, or PR is part
of this plan's creation. Implementation begins only after review approval;
slices then execute in the sequence above, each ending green before the next
begins.

