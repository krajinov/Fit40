# Workout Scheduling & Training Calendar (M15)

Canonical reference for the M15 scheduling milestone: how calendar intent is
modeled and persisted, how dates are generated deterministically, how the
dashboard and program detail surface the schedule, what the two Server Actions
are allowed to trust, and what M15 deliberately does not do. Domain is the
single semantic authority for dates, generation, status and focus;
Application orchestrates with a caller-supplied clock; Presentation consumes
DTO truth and never recomputes it. Scheduling is **intent** — completion,
training history, progression, personal records and weekly insights continue to
read completed `WorkoutSession`s only, and M15 never writes one.

## Scope

M15 makes an enrolled program feel like a real training schedule:

1. **Choose training days** for the current run (e.g. Mon / Wed / Fri).
2. **Generate** a concrete calendar of workout dates deterministically from
   that selection, the authored program order and the run's session facts.
3. **Surface** the schedule: Today / Next / past-due on the dashboard, and a
   current-week Monday–Sunday calendar on program detail.
4. **Adjust** the run's calendar: Set / Change training days (regeneration)
   and a manual **Move** for never-started planned workouts.

Locked non-goals (explicitly NOT provided): persisted weekday preferences,
notifications/reminders, Google/Apple Calendar integration, AI scheduling,
automatic rescheduling of missed workouts, adherence scoring, streaks or any
gamification, readiness/recovery scoring, time-of-day scheduling, timezone
preferences, generic recurring events, a month calendar, week navigation,
drag-and-drop, mutation of authored `TrainingProgram` templates, and any
rewrite of workout history.

## Authority boundaries (three names, three truths)

| Concept | Meaning | Never means |
|---------|---------|-------------|
| `ScheduledWorkout` (`scheduled_workouts`) | **Authored program structure**: one occurrence of a workout template inside a program week (`week_number`, `order_in_week`). Addressed publicly by `(programSlug, weekNumber, workoutOrder)`. | A date, or anything user-specific. Unchanged by M15. |
| `PlannedWorkout` (`planned_workouts`) | **Enrollment-scoped calendar intent**: "I intend to do this occurrence on this date." Identity is the composite `(enrollmentId, scheduledWorkoutId)` — no surrogate id. | Execution, history, or completion. Moving or deleting planning never touches sessions. |
| `WorkoutSession` (`workout_sessions`) | **Factual execution/history**: started/completed sessions with logs. The sole source for completion (M14), progression (M8), PRs (M12) and insights (M13). | Calendar intent. M15 never creates, resumes or completes a session. |

M15 reads session facts into planning through two enrollment-scoped
projections only: `listCompletedScheduledWorkoutIds` (existing) and
`listInProgressScheduledWorkoutIds` (M15 addition, one bounded statement).
Since M17 the configure read additionally loads the run's
`not_performed_workouts` facts (a third, fact-only read) and hands them to
generation as settled input — recording a workout never rewrites a
`planned_workouts` row itself. The schedule READ is different: session
execution truth (completed + in-progress projections) and the
not-performed settlement facts are mutually exclusive per occurrence, so
the calendar read projects them from ONE coherent database snapshot
(`ScheduleExecutionFactsRepository`, a single statement) — never from
independent statements that could tear across a concurrent settlement
transition (see `docs/run-closure.md` for the general invariant).

## Persistence (`planned_workouts`, migration 0013)

```sql
planned_workouts (
  enrollment_id          text NOT NULL → program_enrollments.id ON DELETE CASCADE,
  scheduled_workout_id   text NOT NULL → scheduled_workouts.id  ON DELETE RESTRICT,
  planned_date           date NOT NULL,
  PRIMARY KEY (enrollment_id, scheduled_workout_id),
  UNIQUE (enrollment_id, planned_date)
)
+ index planned_workouts_scheduled_workout_id_idx (FK RESTRICT checks — the
  composite PK leads with enrollment_id, so it cannot serve a
  scheduled_workout_id-only predicate).
```

- `planned_date` is a PostgreSQL **DATE** carried through Drizzle in `mode:
  'string'`, so the canonical `YYYY-MM-DD` value never round-trips through a
  JavaScript `Date` or local-time conversion (domain `PlannedDate` is a
  branded string; `src/lib/dates.ts` formats it from calendar components with
  no `Date` at all).
- One planned workout per occurrence per run (PK) and **per calendar date per
  run** (unique) — both are invariants/backstops, not the concurrency
  mechanism (see below).
- **No backfill.** Existing enrollments start with zero planning rows and are
  unconfigured until the user opts in; no destructive reset is required.
- **No persisted weekday preference.** Generated dates are the truth; the
  weekday selection is input to generation, never stored (no `training_days`
  column/table exists).
- **No CHECK involving "today"** — past/future is time-dependent and lives in
  the Domain/application with the request clock.

M17's settlement fact lives in its **own** table
(`not_performed_workouts`, migration 0014 — see
[Run Closure & Not-Performed Settlement](run-closure.md)); recording or undoing
never inserts, updates or deletes a `planned_workouts` row. The row and the
fact are two legal, independent truths until the next regeneration, which
treats recorded occurrences as settled and may remove their rows.

## Calendar model (UTC Monday–Sunday)

- A planned date is a calendar date with no time and no zone. Week boundaries
  are **Monday–Sunday**, the same model the M13 weekly insights use
  (`training-week.ts`), so the schedule calendar and the insights week agree.
- "Today" is always derived from a **caller-supplied `now: Date`** via the
  domain `plannedDateFromInstant` (UTC calendar day). Application and domain
  code never call `Date.now()` / `new Date()` themselves; each Server Action
  creates `now` at its own boundary.
- Week slots are built by the presentation view from the DTO's `today` through
  the domain helpers `startOfPlannedWeek` / `addDaysToPlannedDate`
  (`src/features/schedule/schedule-week-view.ts`) — no scheduling rule is
  recreated in a component, and `YYYY-MM-DD` is never parsed as an instant.
- There is **no timezone preference subsystem**. The limitation (the calendar
  day rolls over at a UTC boundary, exactly as M13 already discloses) is stated
  in exactly **two** user-facing lines, both on program detail:
  1. setup helper: *"Weeks run Monday–Sunday on the app's UTC calendar — the
     same calendar your weekly insights use."*
  2. configured weekly caption: *"Weeks run Monday–Sunday (UTC)."*

  No other scheduling UI label, date, error or form mentions UTC.

## Deterministic generation (`generatePlannedSchedule`)

Pure domain service (`src/domain/services/planned-schedule.ts`). Inputs:
`occurrencesInProgramOrder`, `trainingDays`, `today`, `completedIds`,
`inProgressIds`, `notPerformedIds`, `currentPlan` (all facts supplied by the
caller).

**Partition** (authored occurrence order):

- **settled** — completed **or** recorded as not performed (M17) → **no row**
  (the calendar never invents intent for performed work, and a record is not
  intent either; a recorded occurrence's existing row is dropped by
  replacement while its fact survives).
- **frozen** → has a live in-progress session **and** an existing planned row
  → the row is carried **verbatim** (never moved, its date reserved).
- **open** → everything else: never-started occurrences, manually moved
  never-started rows (overwritten — regeneration is authoritative), and
  in-progress occurrences without a row (dated forward, never fabricated into
  the past).

**Occupied dates** are exactly the frozen rows' dates — nothing else. The
frozen date is reserved even when its weekday is not selected, and it can
never collide with a generated date; frozen dates before the first eligible
date simply do not affect generation.

**Candidates** are the strictly increasing dates `d ≥ firstEligibleDate` whose
weekday is selected, where `firstEligibleDate` is `today` when today is
selected and the next selected weekday otherwise. Open occurrences each take
the next unoccupied candidate, so generated dates are unique, strictly
increasing in authored order, and monotonic.

**Output ordering** is calendar order (planned date asc, then occurrence id) —
the persisted read order — and is deterministic for identical inputs. A row
whose `enrollmentId` does not match the run is rejected (no cross-enrollment
generation). All-settled (all completed and/or recorded) → `[]`; frozen-only →
the frozen rows.

Locked edge cases (each pinned in `planned-schedule.test.ts`):

| # | Case | Behavior |
|---|------|----------|
| A | Frozen in-progress row dated in the past | Stays on its historical date; its **status is `in-progress`, never `past-due`** (session truth outranks the date). |
| B | Frozen row on a newly selected weekday | That date is reserved and skipped by generation. |
| C | Frozen row on a non-selected weekday | Stays frozen; harmless (candidates only ever land on selected weekdays). |
| D | Frozen dates before the first eligible date | Do not distort or delay generation. |
| E | Authored vs calendar order | May diverge around frozen rows — allowed, deterministic; authored program semantics are never reshuffled. |
| F | Manually moved never-started rows | Open: overwritten on regeneration; their old dates reserve nothing. |
| G | In-progress occurrence with no row (legacy bootstrap) | Open: receives a forward (today-or-next-selected) date, never a fabricated past date; freezes on later regenerations. |
| H | Recorded occurrence, with or without a row | Settled: receives no row on regeneration; its fact survives independently (unplaced-recorded if the row is dropped). Undo never restores a row. |

## Status & focus (`resolvePlannedWorkoutStatus`, `resolveScheduleFocus`)

Status precedence is locked and session-derived facts always outrank dates:

1. completed session → **`completed`**
2. live in-progress session → **`in-progress`**
3. recorded `NotPerformedOccurrence` (M17) → **`not-performed`** (an explicit
   user attestation, never date-derived)
4. planned date before today → **`past-due`**
5. otherwise → **`planned`**

Focus over the run's planned items (`ScheduleFocusDto`):

- **today** — the item dated exactly today, whatever its status (a workout
  completed today is still today's workout); null when nothing is planned for
  today.
- **next** — the earliest **not-completed, not-recorded** item strictly after
  today; null when nothing future remains.
- **pastDue** — the not-completed, not-in-progress, not-recorded items before
  today, with `{ count, earliest }` (in-progress items are never "behind";
  recorded occurrences are settled, not behind); null when nothing is behind.
- **notPerformedRecorded** — the run's recorded occurrences among the planned
  items (M17), so surfaces can count them without recomputing.

Presentation consumes these results as-is; no component recomputes status,
focus, "today" or eligibility.

## Read paths

- **`GetEnrollmentScheduleUseCase`** — input `{ userId, program (the already
  hydrated aggregate), now }` (the `GetProgramEnrollmentUseCase` convention:
  one catalog hydration per request). Resolves the run by the trusted
  `(userId, program.id)` pair, then reads five bounded statements: enrollment
  lookup + planned rows + completed ids + in-progress ids + recorded-not-performed
  facts. Not enrolled →
  `ok(null)`; no planned rows → `configured: false` (never invented dates); a
  planned row outside the program aggregate → thrown contract violation
  (corrupt state, never silently omitted).
- **Dashboard** — `GetCurrentProgramDashboardUseCase` composes the schedule
  read with the aggregate it already loaded (`execute(userId, now)`); a typed
  or throwing failure degrades to `{ status: 'unavailable' }` with a
  `console.error` (the M13 insights convention) — **`unavailable` is never
  rendered as "unconfigured"**. The page captures `now = new Date()` once per
  request and passes it down.
- **Program detail** — the page captures its own `now` at the server boundary
  and reads only for an **enrolled, not-completed** run (completed runs never
  read planning; the M14 surface is authoritative). Failures log and degrade
  the schedule section only; the rest of the page keeps rendering.
- Presentation/actions never import scheduling repositories; the only
  repository import on the schedule feature is its `services.ts` composition
  root.
- **M16 consumes the same rows read-only:** `GetEnrollmentFollowThroughUseCase`
  issues the same bounded shape as the schedule read (enrollment lookup, planned
  rows, and the three independent occurrence reads — completed activity,
  in-progress ids, recorded-not-performed facts) and reports how the CURRENT
  plan held up. See
  [Plan Follow-Through](follow-through.md) for the shared limitations (no
  historical plan, no schedule mutation).

## Write concurrency (parent-first lock)

The unique constraints are backstops, not the mechanism. Every planning write
serializes on the current run's enrollment row **before** touching
`planned_workouts`:

```sql
SELECT id FROM program_enrollments WHERE id = $1 FOR NO KEY UPDATE
```

- **Parent-first on purpose:** M14 restart (`replaceExpectedWithNew`) and
  leave (`delete`) remove the parent row first and cascade to children, so
  planning writes and lifecycle writes contend on the same row in the same
  order and can never form a lock cycle (proved by forced-overlap integration
  tests, not by a lucky `Promise.all`).
- `FOR NO KEY UPDATE` (not `FOR UPDATE`) keeps the lock compatible with the
  `FOR KEY SHARE` a bare `WorkoutSession` INSERT takes for its FK check — a
  session row's FK probe never waits on the parent lock (proved by test). The
  **production** creation path, however, deliberately takes the enrollment lock
  *first* (M17), so workout start queues behind planning, lifecycle and
  settlement writes — same row, same order, no cycles, no retry.
- **M17 settlement joins the same contract:** record, undo and start all lock
  this row first, read their facts under the lock, and act in one transaction
  (see [Run Closure & Not-Performed Settlement](run-closure.md) for the
  serialization and guarded-delete rules).
- **`replaceAllForEnrollment`** is whole-set replacement: lock → zero rows
  means `false` (nothing written) → DELETE → one multi-row INSERT (empty set
  is valid) → `true`. **`reschedule`** locks, re-checks the occurrence's M17
  not-performed fact **under that lock**, and only then runs one conditional
  UPDATE — returning a typed outcome: `moved`, `not-moved` (zero rows, or a
  vanished run), or `recorded-not-performed` (**zero planned writes**). No
  retry loops exist anywhere in M15.
- **Constraint translation:** only a violation naming exactly
  `planned_workouts_enrollment_date_unique` during `reschedule` becomes
  `PlannedDateConflictError` (the one business conflict: the target date is
  already taken). PK/unique violations during replacement and every other
  database error stay unexpected and propagate.
- **Stale writes:** a `not-moved` result triggers **exactly one** read-only
  `findByUserAndProgram` re-check. No current enrollment **or a different
  EnrollmentId** (an M14 restart replacement) → `NOT_ENROLLED`; the same
  enrollment → `SCHEDULE_CHANGED`. Never a second write, never a retry, and a
  stale old-run request can never retarget the fresh run.

## Lifecycle (leave / restart / rejoin)

- **Leave:** deleting the enrollment cascades its planning rows away in the
  same database action; sessions remain per the existing `ON DELETE SET NULL`
  semantics (detached user-global history).
- **Restart:** `replaceExpectedWithNew` deletes the old enrollment inside its
  ONE transaction → the old run's planning disappears with it; the fresh run
  starts with **zero** planned rows (unconfigured). Sessions stay detached;
  history, PBs and M8 progression inputs are untouched.
- **Rejoin:** a new `EnrollmentId` is a new run → planning starts empty by
  construction; nothing stale can be inherited or written back (integration
  tests pin all three paths, including "no orphan rows").

## Server Action trust boundaries

Both actions (`src/features/schedule/actions/`) follow the locked form
architecture: `'use server'` → `requireUser()` → Zod at the boundary → Slice 4
use case → typed action state → `revalidatePath`.

| | `configureTrainingDaysAction` | `reschedulePlannedWorkoutAction` |
|---|---|---|
| Accepts from FormData | `programSlug`, repeated `weekday` (1–7, ≥1) | `programSlug`, `weekNumber`, `workoutOrder`, `date` |
| Never accepts | `userId`, `EnrollmentId`, `ScheduledWorkoutId`, `now`, `today` | all of those, plus `sessionId` and the current planned date as authority |
| Trusted user | `requireUser()` session only | same |
| Clock | `const now = new Date()` at the action boundary | same |
| Validation split | Zod = shape only (slug, integer 1–7, non-empty); the use case owns `TrainingDays` and generation | Zod = shape only (`YYYY-MM-DD` regex); the use case owns calendar validity (`createPlannedDate`), `DATE_IN_PAST`, eligibility and occupancy |
| Success revalidation | `/programs/{slug}` + `/dashboard` — exactly two paths, no redirect | same |
| Errors | expected → typed `{ code, message }`; unexpected → throws to the error boundary; **no automatic retry** | same |

The client wrapper injects the server-rendered `programSlug` (and authored
coordinates) via `formData.set`, so the scheduling forms' DOM contains only
`weekday` checkboxes and one `type="date"` input — no enrollment id, database
id, session id or user id appears anywhere in the markup (pinned).

## Surfaces

**Dashboard (`TrainingScheduleCard`)** — additive, rendered under "Up next"
only while the run is not complete. States: failed read → renders nothing;
`configured: false` → the setup prompt with "Set training days" linking to the
program detail page (where the form lives); configured → **TODAY** (badge +
authored coordinates; "Start workout" / "Resume workout" via the existing
session route, or "Completed today" with no Start), **NEXT WORKOUT** (only
when nothing is actionable today, with a component-based "Planned for Sep 23"
date and no competing primary CTA), and a neutral "{n} planned workout(s)
behind schedule" cue (never "failed / skipped / missed"). M13 insights, recent
training and the M14 completed card are untouched; no `EnrollmentId` reaches
the DOM.

**Program detail (`ProgramScheduleSection`)** — between the enrollment panel
and the authored weeks (which are unchanged), anchored at
`id="training-schedule"`:

- *Unconfigured:* heading, existing copy, "No training days set yet.", the
  setup UTC helper, and the **training-days form**: seven labelled weekday
  chips (native checkboxes, ≥48px, keyboard operable) and "Set training days".
  **No day is pre-checked in either mode** — M15 stores dates, so the UI never
  claims a stored weekday preference.
- *Configured:* the past-due summary (count + earliest), the seven-slot
  Monday–Sunday week (`<ol>`, today marked with the word "Today" +
  `aria-current="date"`, empty days read "No workout planned", statuses as
  text: Planned / In progress / Completed / Past due / Recorded as not
  performed), the weekly caption, a collapsed **"Change training days"**
  disclosure whose copy states the
  replacement semantics ("Saving replaces the dates of future workouts;
  completed workouts stay in history and in-progress workouts keep their
  current date"), and a **"Move"** disclosure on each never-started cell.
- **Settlement affordances (M17):** `planned` / `past-due` / `in-progress`
  cells expose the **"Didn't train this"** record form (with the
  motion-sensitive Move disclosure warning that recording removes an empty
  in-progress workout); a `not-performed` cell exposes **"Undo"** only — no
  Start, no Move; `completed` cells expose no settlement control. Recorded
  occurrences with no current row appear in the **unplaced list** below the
  grid (authored labels, Undo, no invented date). Copy and the full state
  matrix live in [Run Closure & Not-Performed Settlement](run-closure.md) and
  [UI](ui.md).
- **Move gating (display):** `planned` and `past-due` expose Move (the
  approved plan names manual rescheduling as a past-due remedy);
  `in-progress` shows the existing **Resume** link and `completed` shows no
  Start and no Move. The use case remains authoritative regardless of gating:
  target today/future accepted, target in the past rejected
  (`DATE_IN_PAST`), occupied date rejected (`DATE_ALREADY_PLANNED`), same
  date = success/no-op with no write, completed/in-progress blocked, stale
  state → typed `NOT_ENROLLED` / `SCHEDULE_CHANGED` without retry. A record
  that committed **after** the pre-read but before the locked update is
  re-checked under the enrollment lock and refuses the move
  (`OCCURRENCE_RECORDED_NOT_PERFORMED`) with zero planned writes, so a settled
  occurrence is never left looking movable.
- *Completed run:* the page renders no scheduling section at all — M14's
  completion/restart/leave surface stays the only lifecycle state. A
  **concluded-but-incomplete** run (M17) still reads planning and renders the
  calendar (its remaining occurrences are recorded, shown with the
  `not-performed` status and Undo) together with the "Run closed" callout.

## Intentional bounded race (session writes vs planning writes)

Planning writes are deliberately **not** serialized against session
**content** writes (logging sets, completing) — a session may complete between
an eligibility read and a planning write. The consequence is bounded and
cosmetic: the next read reports the session-derived status, and no truth is
mutated — planning is intent, sessions are fact. M15 does not lock
`WorkoutSession` rows for content writes, does not add cross-repository
transactions, and never alters M14/M8 semantics to close it.

Two paths were later serialized on purpose (M17): **workout start** takes the
enrollment lock before creating its session (start queues behind planning and
lifecycle writes instead of racing them), and **settlement** (record/undo)
runs entirely under the same lock with a version-pinned guarded delete. So the
residual bounded race is exactly: a content write landing between a planning
read and a planning write — never a duplicated settlement, never a destroyed
session.

## Truthfulness rules (what the UI is not allowed to claim)

- **No stored weekday preference.** The change form always starts empty and
  its copy says the selection is a replacement; planned dates — not
  reverse-engineered weekdays — are the persisted truth.
- **Missed dates stay required.** A past-due planned workout remains
  incomplete, remains part of completion, and is shown with neutral wording
  ("behind schedule") — never "failed", "missed" or "skipped" (M15 creates no
  fact of that kind). Nothing auto-resolves or auto-skips it: a past-due date
  never becomes a record.
- **Regeneration never touches performed work:** settled occurrences —
  completed **or** recorded — get no row (history and facts are untouched),
  and frozen in-progress rows keep their date.
- **Not-performed wording (M17, locked):** the stored status is exactly
  **"Recorded as not performed"**, the action is **"Didn't train this"**, the
  retraction is **"Undo"** — never `skipped` / `missed` / `failed` /
  `incomplete` at the workout level, never a confirmation dialog, never a
  bulk action. Recording is an explicit attestation; no surface claims the
  system detected it. See [Run Closure & Not-Performed Settlement](run-closure.md).
- **Completed runs are never sold as active schedules** on either surface.
- No enrollment id, `scheduled_workout_id`, session id or user id is ever
  placed in a form, link or URL; navigation uses authored public coordinates
  only (`programSlug` + `weekNumber` + `workoutOrder`).

## Tests & acceptance evidence

- **Domain:** `tests/unit/domain/value-objects/{planned-date,training-days}.test.ts`,
  `entities/planned-workout.test.ts`,
  `services/{planned-schedule,schedule-focus}.test.ts` — generation rules and
  edge cases A–G, status/focus precedence, ordering, cross-enrollment guard;
  `services/planned-schedule-not-performed.test.ts` — M17 settled-exclusion
  (edge case H).
- **Application:** `get-enrollment-schedule`, `configure-training-days`,
  `reschedule-planned-workout` use-case tests (ownership, one hydration,
  stale mappings, no-retry, session-never-written), plus the dashboard
  composition tests (`get-current-program-dashboard`).
- **Infrastructure (real PostgreSQL):** `planned-workout-schema` (exact
  constraint names), `planned-workout-repository` (invariants, ownership
  isolation, statement bounds — 1-statement read, constant 3-statement
  replacement regardless of set size), `planned-workout-lifecycle`
  (leave/restart cascade, detached history, no orphans),
  `planned-workout-concurrency` (forced-overlap matrix: configure‖configure,
  configure/reschedule ‖ restart/leave in both orders, deadlock absence, a
  bare session INSERT's FK probe never blocked), the InMemory/mapper fakes, and
  the in-progress
  session projection (1-statement bound via the postgres.js debug hook).
- **Presentation & actions:** dashboard card/view/page + `lib/dates`
  formatter; program-detail page and section (Move gating, disclosures,
  single UTC line per state, no db ids); schedule week-view; both Server
  Action suites (trusted inputs, server clock, exact two-path revalidation,
  full error mapping, propagation, no retry); both form suites (pending
  disabled, `role="alert"`, canonical date submission, selection preserved
  across a failed save).
- Totals: **173 unit test files / 2251 unit tests**, **23 integration files /
  313 integration tests**, `npx tsc --noEmit` clean, `npm run lint` clean.

## Commit chain (milestone_15)

1. `8325cac` feat: add workout scheduling domain primitives (M15 Slice 1)
2. `6f5645b` feat: add planned workout persistence (M15 Slice 2)
3. `e6ac27f` feat: add in-progress session projection (M15 Slice 3)
4. `0747582` feat: add workout scheduling use cases (M15 Slice 4)
5. `6f8eb32` feat: surface workout schedule on dashboard (M15 Slice 5)
6. `1309e67` feat: show workout calendar on program detail (M15 Slice 6)
7. `f99d3d9` feat: add workout schedule controls (M15 Slice 7)
8. docs: finalize workout scheduling milestone (M15 Slice 8, this commit)