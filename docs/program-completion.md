# Program Completion & Restart (M14)

Canonical reference for the M14 program lifecycle: how completion is derived,
how a completed run restarts atomically, what the completion summary reads
and presents, and what M14 deliberately does not do. The Domain layer is the
semantic authority for completion; Application orchestrates; no completion
state is ever persisted.

## Scope

M14 makes a finished program run a first-class, truthful moment:

1. **Derive** program completion for the current enrollment.
2. **Surface** it: a dedicated completion route, the completed enrollment
   panel, a conditional Session Completed callout, and the dashboard's
   completed card.
3. **Restart** a completed run through ONE atomic compare-and-replace write,
   preserving user-global training history.
4. Report the run's **historical** Personal Record events (M12 semantics)
   for the current run only.

Locked non-goals: persisted completion state, enrollment history/archive,
new dashboard reads, and any e1RM / calories / training-time / adherence /
XP copy.

## Completion semantics (derived, not persisted)

Authoritative rule — `isProgramComplete`
(`src/domain/services/program-progress.ts`):

- the program has **at least one scheduled workout**, and
- **every scheduled workout** has a completed session attached to the
  **current enrollment** (the completed scheduled-workout id projection).

There is no enrollment status column, no completion timestamp on the
enrollment, and no persisted completion flag anywhere. Completion is
recomputed from the program schedule plus
`listCompletedScheduledWorkoutIds(enrollmentId)`.

**Completion date** — `resolveProgramCompletionDate` returns the latest
`completedAt` among the run's own completed sessions that match the program
schedule (null when none). There is no persisted enrollment completion date.

### Zero-workout programs (intentional divergence)

- `isProgramComplete` returns **false** for a zero-scheduled-workout program
  (completion requires at least one scheduled workout).
- Legacy `getNextWorkout` may return **null** for the same program (reads as
  "nothing left"), so the two helpers intentionally diverge on the empty
  schedule.
- Restart uses `isProgramComplete` as its authority, so a zero-schedule
  program **cannot** be restarted (pinned as locked semantics in tests).
- Broader reconciliation of the two helpers is explicitly out of M14 scope.

## Current run identity

The current run **is** the current `ProgramEnrollment` id: the completed
sessions attached to that enrollment define the run's history, tally,
completion date, and PR candidates.

Restart deletes the old enrollment row; the existing
`workout_sessions.enrollment_id` FK (`ON DELETE SET NULL`) detaches its
sessions in the same database action. Consequences:

- Training History, current Personal Bests, and M8 progression inputs are
  **user-global** and survive verbatim.
- The old run's **enrollment-scoped completion summary cannot be
  reconstructed later** — the enrollment id that scoped it no longer exists.
  This is an **intentional M14 limitation**; no enrollment-history or archive
  table exists, and nothing in M14 implies one.

## Restart (one atomic compare-and-replace)

`RestartProgramUseCase` (`src/application/use-cases/restart-program.ts`)
performs exactly one write attempt:

1. Validate the trusted `userId`; resolve the program by slug.
2. Load the **current** enrollment server-side — the caller never supplies an
   expected EnrollmentId, and no enrollment id ever crosses the client
   boundary.
3. Verify completion with `isProgramComplete` against the current
   enrollment's completed ids (incomplete → `PROGRAM_NOT_COMPLETE`, zero
   writes).
4. Build a fresh enrollment (`IdGenerator.generate()`,
   `enrolledAt = new Date()`; same user, same program).
5. Call `replaceExpectedWithNew(oldId, fresh)` **exactly once**.
6. `false` (stale CAS) → a **single read-only** re-check mapped to
   `NOT_ENROLLED` / `PROGRAM_NOT_COMPLETE` / `ENROLLMENT_CHANGED`. No second
   write, no retry.
7. `EnrollmentAlreadyExistsError` → `ALREADY_ENROLLED` (no retry). Other
   database errors stay unexpected and propagate.

There is no Leave + Enroll composition anywhere in restart.

### PostgreSQL transaction (`replaceExpectedWithNew`)

All inside ONE transaction:

1. `DELETE … WHERE id = <expected> RETURNING` the identity columns.
   Zero rows → the expected enrollment is gone → return `false`; no insert.
2. **Identity guard**: the returned row must match the expected userId and
   programId, else `EnrollmentIdentityMismatchError` → rollback.
3. `INSERT` the fresh row; commit → success.

Any failure after the delete throws inside the transaction, so the rollback
restores the old enrollment **and** its session attribution. Only a unique
violation naming `program_enrollments_user_program_unique` maps to
`EnrollmentAlreadyExistsError`; every other database error remains an
unexpected error (both directions pinned by tests).

### Concurrency (proven behavior, not an isolation-level claim)

From `tests/integration/database/program-restart.test.ts` (test C) under
this repository's PostgreSQL setup — observed row-lock serialization; M14
does **not** claim generic serializable isolation:

Two truly concurrent restarts of the same completed enrollment:

- exactly one succeeds;
- the loser's targeted `DELETE` waits on the expected row's lock;
- after the winner commits, that delete matches **zero rows** → CAS `false`;
- the read-only re-check observes the winner's **fresh, incomplete**
  enrollment → the loser returns `PROGRAM_NOT_COMPLETE`;
- exactly **one** fresh enrollment remains — no duplicates, no orphans, no
  unenrolled final state.

A serialized second restart after success returns `PROGRAM_NOT_COMPLETE` and
leaves the fresh enrollment untouched (test D); a different user receives
`NOT_ENROLLED` (test E).

## History continuity

Verified invariants (program-restart test B):

- Training History survives restart unchanged.
- Current Personal Best truth survives.
- M8 recent completed-exercise-performance history / progression inputs
  survive.
- Old sessions detach (`enrollment_id → NULL`) and still render in history.
- The fresh enrollment begins with **zero** completed scheduled workouts.

Not preserved (by design): the old run's enrollment-scoped completion
summary — see Current run identity.

## Completion summary route

`/programs/[programSlug]/completed` (server-rendered): invalid or unknown
slug → `notFound()`; unauthenticated → login with a `?next=` deep link back;
not enrolled (`null`) or incomplete → redirect to program detail; completed →
render. Completion state comes only from `GetProgramCompletionSummaryUseCase`
— never query params or client state. After a successful restart the route
naturally redirects, because the fresh enrollment is incomplete.

The summary reports, for the current run only:

- program identity;
- completed / total workouts;
- the derived completion date;
- distinct exercises trained;
- the **exact** historical PR-event count (uncapped) plus at most the newest
  **5** events for display.

**Distinct exercises trained** = distinct *performed* ExerciseIds from
occurrences with at least one logged set: a substitution counts the
replacement (performed) identity, user-added exercises participate, and
skipped or set-less occurrences do not count.

### Historical PR events (M12 semantics — not current PBs)

The summary answers "what records happened during this run", never M13's
"current PBs set in a window". Pipeline:

1. Candidates originate **only** from completed sessions attached to the
   current enrollment (`listCompletedByEnrollment`).
2. `extractRecordCandidates` (Domain) turns logged sets into candidates under
   M12 eligibility, attributed to the **performed** ExerciseId.
3. `findBestValuesBefore` (user-global) supplies each candidate's best value
   strictly before its position — prior history may come from detached
   sessions, previous runs, or other programs.
4. `resolveRecordEvents` applies M12 strict-greater / first-exposure / tie
   semantics; a run PR later surpassed **within the run** remains a truthful
   historical event of the run.
5. `recordEventCount` is the **exact, uncapped** event count; the display
   list carries the 5 newest events ordered by the established
   `PerformancePosition` ladder (completedAt → startedAt → sessionId →
   exerciseOrder → setNumber).
6. Catalog metadata is batched **only for the displayed events**; a row whose
   metadata cannot be resolved is omitted from display without changing the
   exact count.

Presentation wording is "Personal records during this program" — never
"current personal bests".

## Read-path performance (implemented shape only)

`listCompletedByEnrollment`:

- empty enrollment → **1** statement (the session query short-circuits);
- N ≥ 1 sessions → exactly **3** bounded statements: one session query, one
  batched exercise-log query, one batched set-log query — no N+1 (pinned by
  a postgres.js debug-hook statement counter).

No other performance numbers are claimed by M14.

## Presentation surfaces

- **Completion page** — factual cards ("Program completed" badge, workout
  tally, completion date, distinct exercises) plus the capped PR rows;
  primary action "Start program again" (Slice 6 `RestartProgramButton`),
  secondary "Choose another program" → `/programs`.
- **EnrolledProgramPanel** — complete enrollment only: "View completion
  summary" → the route, plus the shared restart button; Leave preserved.
  Incomplete enrollments keep their existing up-next/progress behavior and
  never see completion controls.
- **Session Completed** — the `programCompletion` callout ("Program complete"
  → summary) renders only when the server-resolved enrollment view says
  complete. The program/enrollment resolution runs **only** for
  `screenState === 'completed'` (a conditional program-catalog read exists
  solely because `GetProgramEnrollmentUseCase`'s input contract takes the
  program aggregate; the displayed name reuses the workout DTO). No callout
  on the active/in-progress screen and no equivalent workout-detail callout;
  an optional typed read failure degrades to **no callout**, never a false
  completion claim.
- **Dashboard `ProgramCompletedCard`** — "View summary" → the completion
  route; "Browse programs" kept; **no restart button on the dashboard**
  (locked M14 product decision); no dashboard read or use case changed.

## Restart action security

- The browser submits **`programSlug` only** (`enrollmentFormSchema`).
- `userId` comes from the trusted authenticated session (`requireUser`) —
  any `userId` field in form data is ignored by design.
- The expected old EnrollmentId **never** crosses the client boundary; the
  use case loads the current enrollment server-side.
- The Server Action delegates the mutation entirely to
  `RestartProgramUseCase` — no repository call inside the action, no
  leave/enroll composition.
- Success revalidates catalog, program detail, completion, dashboard and the
  session-page template, then redirects to program detail — never back to
  the completed page; the fresh enrollment makes the completed route
  redirect naturally.

## Intentional limitations

- No persisted completion state; no enrollment status or completedAt column.
- No enrollment history/archive: a pre-restart run's enrollment-scoped
  completion summary is unrecoverable after restart.
- Zero-schedule divergence (`isProgramComplete` false vs legacy
  `getNextWorkout` null) is documented, not reconciled.
- No dashboard restart control and no new dashboard data flow.
- `ENROLLMENT_CHANGED` is reachable only when the current enrollment itself
  is complete (state moved twice); the common concurrent loser observes
  `PROGRAM_NOT_COMPLETE`.

## Tests & acceptance evidence

| Acceptance criterion | Pinned by |
|---|---|
| Zero-workout completion divergence + restart refusal | `tests/unit/domain/services/program-progress.test.ts`, `tests/unit/application/use-cases/restart-program.test.ts` |
| Enrollment-scoped completed-session read | `tests/integration/database/workout-session-repository.test.ts` (`listCompletedByEnrollment`) |
| Bounded hydration (1 empty / 3 statements, no N+1) | same file (postgres.js debug-hook statement counter) |
| Atomic replace, rollback after post-delete failure, stale id, identity guard, constraint-name pinning | `tests/integration/database/program-enrollment-repository.test.ts` (+ InMemory CAS tests) |
| Historical PR-at-time vs current PB; later-surpassed retained; exact count vs cap; incomplete fast path | `tests/unit/application/use-cases/get-program-completion-summary.test.ts` + `tests/integration/database/program-completion-summary.test.ts` (Domain-fold oracle) |
| Successful restart, history/PB/M8 invariance, true concurrency, serialized second restart, ownership | `tests/integration/database/program-restart.test.ts` (A–E) + `restart-program.test.ts` |
| Completion route redirect/notFound semantics | `tests/unit/app/program-completed-page.test.ts` |
| Browser submits slug only (no EnrollmentId/userId) | `tests/unit/features/enrollment/program-completion-summary.test.ts`, `restart-action.test.ts` |
| Conditional session callout; no workout-detail callout | `tests/unit/features/sessions/active-workout-view.test.ts`, `session-completed-callout.test.ts`, `active-workout-screen.test.ts` |
| Completed panel surfacing; dashboard summary without restart | `tests/unit/features/enrollment/enrolled-program-panel.test.ts`, `tests/unit/features/dashboard/program-completed-card.test.ts` |

## Commit chain (milestone_14)

- Slice 1 — `e51f78f` domain completion rules
- Slice 2 — `b4ce703` enrollment-scoped completed-session read
- Slice 3 — `411a919` atomic enrollment replacement primitive
- Slice 4 — `b909164` completion summary read model
- Slice 5 — `a382e43` RestartProgramUseCase (atomic CAS + concurrency proof)
- Slice 6 — `24fa8b5` completion route & experience
- Slice 7 — `19a50c6` completion moment & surfacing
- Slice 8 — documentation, stabilization & final acceptance verification
  (this document)
