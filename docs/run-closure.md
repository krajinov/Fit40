# Run Closure & Not-Performed Settlement (M17)

Canonical reference for the M17 milestone: what the not-performed fact is and
is not, the three distinct truths a run can carry, the settlement ontology and
its invariants, the exact record/undo semantics, the real PostgreSQL safety
model that serializes them, what happens to the fact across the run lifecycle,
and who owns every decision and port. Domain owns the fact, the settlement
decisions and the closure verdicts; Application orchestrates with a
caller-supplied attestation instant; Infrastructure owns the
enrollment-serialized transaction; Presentation delegates and never decides.
M17 does not change completion (M14), progression (M8), personal records
(M12), insights/history (M13), planning (M15) or the follow-through report's
horizon (M16).

## Scope

1. **Record and undo** one authored occurrence of the current run as not
   performed, through one serialized mutation authority.
2. **Derive** run conclusion and restartability from the run's own execution
   truth — never persisted, never date-derived.
3. **Project** the fact into the existing M15 calendar and M16 report without
   inventing dates, rows or a second report.
4. **Surface** honest copy: the record action, the stored state, the undo
   affordance, the unplaced list and the concluded-run panel.

Locked non-goals: no bulk settlement, no confirmation dialog (Undo is the
safety mechanism), no persisted closure or run-status column, no run archive or
enrollment-history table, no date- or clock-derived settlement, no adherence,
score, percentage or judgement vocabulary, no workout-level `skip` / `missed` /
`failed` / `incomplete` used as the settlement concept, no advisory lock, no
`SERIALIZABLE` requirement, no occurrence-lock table, no settlement retry loop,
and no change to any Personal Record, progression, insight or completion read.

## Terminology

| Concept | Canonical name | Where |
|---|---|---|
| Domain entity / fact | `NotPerformedOccurrence` (identity = `(enrollmentId, scheduledWorkoutId)`, plus `recordedAt`) | `src/domain/entities/not-performed-occurrence.ts` |
| Persistence | `not_performed_workouts` (migration **0014**) | `src/infrastructure/database/schema/not-performed-workouts.ts` |
| Record action copy | **"Didn't train this"** | `RecordNotPerformedForm` |
| Stored-state copy | **"Recorded as not performed"** | `schedule-week-view.ts`, calendar, cards, CTA band |
| Retraction copy | **"Undo"** (subtext "It goes back to not started.") | `UndoNotPerformedForm` |
| Concluded panel | **"Run closed — {n} completed, {m} recorded as not performed"** | `ConcludedRunCallout` |

Rules:

- **Not-performed is an explicit user attestation, not an inference.** It exists
  only because the user pressed the record action; a past-due date, an empty
  calendar, the passage of time or a missing session never produces it. There
  is no clock in the Domain rule and `recordedAt` is the caller-supplied
  attestation instant (the Server Action boundary owns the request clock).
- The workout-occurrence-level vocabulary above shares nothing with M10's
  exercise-level `skip` semantics, and none of `skipped` / `missed` / `failed`
  / `incomplete` may ever name this settlement.

## Three distinct truths

Three authorities answer three different questions about one run. They are
deliberately allowed to disagree, and none is derivable from another.

### 1. Program completion

- **Question:** has every authored occurrence of the run been performed?
- **Authority:** `isProgramComplete`
  (`src/domain/services/program-progress.ts`) over the program's authored
  ordered structure plus `listCompletedScheduledWorkoutIds` only.
- **A recorded occurrence does NOT count as completed.** Completion counts
  completed workout sessions and nothing else; a run with recorded occurrences
  can never be complete through those records.

### 2. Run conclusion

- **Question:** is every authored occurrence of the run settled — by a
  completed session **or** by a `NotPerformedOccurrence`?
- **Authority:** `isRunConcluded` / `resolveRunClosure`
  (`src/domain/services/run-closure.ts`) over the authored program plus
  completed ids and not-performed ids.
- **Conclusion means settled, not necessarily performed.** A run may be
  concluded but not complete.

### 3. Restartability

- **Question:** may this run start over?
- **Authority:** `isRunRestartable` — `programComplete || runConcluded`.
  Complete runs and concluded runs are restartable; an open run is not, so
  "start over" can never discard outstanding work. Restartability is not
  completion and must never be described as it.

Worked example — 30 authored occurrences, all by the user's own actions:

| | |
|---|---|
| 30 completed · 6 recorded as not performed · 0 open | |
| Conclusion | **concluded** — `openWorkouts === 0` |
| Completion | **not complete** — 6 occurrences have no completed session |
| Restart | **restartable** — complete OR concluded |
| Completion semantics | **NOT eligible** — no completion summary, no "program complete" claim |

The conclusion has no clock: it stays false across any number of days and
opens the moment a completed session or record lands. It is **not** a date
rule and never claims the user performed the workout.

## Settlement ontology and invariants

One authored occurrence of one run holds at most one settlement. Legal
combinations:

| State | Legal? | Notes |
|---|---|---|
| Planned occurrence, open (row, no session, no fact) | yes | the ordinary case |
| Unplaced occurrence, open (no row, no session, no fact) | yes | never configured, or row removed by regeneration |
| Planned row + completed session | yes | M14 truth |
| Completed session, no current planned row | yes | history survives a regenerated calendar |
| Planned row + `NotPerformedOccurrence` | yes | legal until the next regeneration |
| `NotPerformedOccurrence`, no current planned row | yes | the "unplaced recorded" projection |
| Planned or unplaced occurrence + live in-progress session | yes | session truth outranks the calendar |
| Live in-progress session + `NotPerformedOccurrence` | **no** | unreachable through valid writes (I2) |
| Completed session + `NotPerformedOccurrence` | **no** | contradictory execution truth (I1) |
| Duplicate `NotPerformedOccurrence` for one occurrence | **no** | composite primary key |

- **I1 — one settlement per authored occurrence.** Valid writes cannot produce
  completed + recorded: recording refuses an occurrence with a completed
  session, and starting a recorded occurrence writes nothing, so no session
  can exist to complete afterwards; the composite primary key rejects a
  duplicate record.
- **I2 — live meaningful workout work and a not-performed record cannot
  coexist.** Recording an occurrence with an in-progress session either deletes
  the abandoned zero-set session atomically and inserts the fact, or refuses
  with `OCCURRENCE_HAS_LOGGED_WORK`; starting a recorded occurrence refuses
  before any insert.

A read-time contradiction fails **loudly, never reconciles**:
`assertOccurrenceSettlementIsConsistent` (M15 status/focus, M16 outcomes) and
`resolveRunClosure`'s authored-id check throw a `… contract violated: …`
error, because both facts are authoritative and any precedence rule would
report a state matching neither. The one deliberate exception is a live
session: `in-progress` outranks the record so a fact never relabels work
happening now — a combination unreachable in a healthy run anyway (recording
deletes the abandoned session; a session with logged work refuses recording).

## Record and undo semantics

The one rule is `decideRecordNotPerformed`
(`src/domain/services/not-performed-decision.ts`), evaluated **inside** the
transaction-owning Infrastructure module, exactly once, under the enrollment
lock, over facts read under that lock:

| Session state (under lock) | Fact exists | Decision |
|---|---|---|
| completed | either | refuse `OCCURRENCE_ALREADY_PERFORMED` (zero writes) |
| in progress, ≥ 1 logged set | either | refuse `OCCURRENCE_HAS_LOGGED_WORK` (zero writes) |
| anything | yes | refuse `OCCURRENCE_ALREADY_RECORDED` (zero writes) |
| none | no | **insert the fact** |
| in progress, zero logged sets | no | **delete the abandoned session + insert the fact, atomically** |

- A refusal writes nothing — no fact, no session, no child row.
- `run-vanished` (a concurrent leave/restart won) maps through exactly one
  read-only re-check to `NOT_ENROLLED` or `ENROLLMENT_CHANGED`.
- `contract-violation` (the database refused a write the decision authorized)
  is **thrown** as `NotPerformedWriteContractViolationError`, never converted
  into a business Result, and rolls the transaction back.

**Undo** (`decideUndoNotPerformed`):

- deletes the fact, and that is the whole write;
- never resurrects a deleted zero-set session;
- never creates a planned row and never regenerates the calendar;
- never touches completed or detached session history;
- refuses an occurrence with no fact as `OCCURRENCE_NOT_RECORDED`.

After Undo, a rowless occurrence is open/unplaced again — ordinary "not
started" — until the user's next explicit regeneration.

## Concurrency authority

The safety model is the design — no advisory locks, no `SERIALIZABLE`
requirement, no occurrence-lock table, no persisted settlement status, and no
retry loop anywhere in the settlement path.

### Cross-table serialization (the lock contract)

One enrollment row is the shared mutable authority; every cross-table write
path locks it **first**, with `SELECT … FOR NO KEY UPDATE`, before reading the
facts it acts on:

- M15 schedule regeneration (`replacePlannedWorkoutSet`);
- M14 restart, leave and completed-session writes;
- M17 record, undo, start and restart.

All take the same row in the same order, so there is no lock-order cycle and
none of them needs a retry. The `NO KEY UPDATE` strength remains compatible
with the `FOR KEY SHARE` a bare session INSERT takes for its FK check.

### Why settlement and session authority cannot race

Record, undo and start all run inside `DrizzleRunOccurrenceWrites`, one
transaction, one lock. Two concurrent settlement attempts serialize on the
enrollment row; the loser observes the winner's committed facts:

- `record || record` → the loser sees the fact and refuses
  `OCCURRENCE_ALREADY_RECORDED`;
- `record || start` → if record wins, start reads the fact under the lock and
  inserts nothing; if start wins, record reads the session state and either
  deletes the abandoned zero-set session or refuses
  `OCCURRENCE_HAS_LOGGED_WORK`.

Session creation is deliberately split across two domains with one-way
dependency: the feature-level start path reads and validates without the
authority, then delegates the insert to `createSessionForOccurrence`; the
application use case never calls `WorkoutSessionRepository.create` itself.
Nothing outside `workout-session-writes.ts` inserts a session row, and the
production `WorkoutSessionRepository.save` is update-only.

### The guarded delete pins the session version (Slice 12)

The record transaction performs, under the lock: diagnostic reads → Domain
decision → guarded session delete → fact insert. The guarded DELETE (zero-set
session, no `set_logs` rows) also pins the diagnosed `version`:

```sql
DELETE FROM workout_sessions
 WHERE id = … AND enrollment_id = … AND scheduled_workout_id = …
   AND version = <diagnosed version>
   AND completed_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM set_logs WHERE session_id = …)
```

This closes a READ COMMITTED anomaly: `NOT EXISTS (set_logs)` on a statement's
first snapshot can miss a concurrently committed set, and EPQ re-evaluates only
the target row's own predicates — a re-checked `version` mismatch, however,
misses too, returns 0 rows, raises the contract violation, rolls back the whole
transaction, and the in-flight set survives. The next attempt sees logged work
and refuses `OCCURRENCE_HAS_LOGGED_WORK`. The pin is **not** optimistic
concurrency control: there is no re-read, no second attempt, no retry — a miss
is a loud `NotPerformedWriteContractViolationError`, never a swallowed
zero-row result. Every authoritative session-content mutation bumps `version`
(`save` sets `version = version + 1`), so the guard holds for both zero-set and
logged sets.

## Historical truth

`NotPerformedOccurrence` is a run-scoped fact, never user-global history:

- **Leave** — the fact cascades with the enrollment (`ON DELETE CASCADE`);
  sessions detach and keep their execution history; nothing is mutated into
  something else, and no undo flag or status is flipped.
- **Restart** — the same cascade clears the previous run's facts with the rest
  of its enrollment-bound rows; the fresh enrollment starts with none. The fact
  never leaks into a future run.
- The fact contributes to **no** Personal Record, completed-workout history,
  completed-occurrence ids or progressive truth of any run. A zero-set session
  deleted at record time was never completed history and stays not-completed
  history; Undo does not resurrect it.
- Detached completed sessions still count as completed execution truth for the
  closure denominator (an authored occurrence with a completed session is
  settled even with no current planned row).

## Scheduling semantics (M15, extended)

Full detail lives in `docs/scheduling.md`; the M17 deltas are:

- **Recording never rewrites planned rows.** The fact is a separate table; the
  authored program and `planned_workouts` are untouched.
- **The calendar read loads recorded facts** as a fifth bounded,
  enrollment-scoped read; `resolvePlannedWorkoutStatus` has a `not-performed`
  status with canonical precedence after `completed` and `in-progress`, and it
  is **not** date-derived.
- **Regeneration excludes settled occurrences** — completed **and**
  recorded — so replacing the plan may remove a recorded occurrence's row. The
  fact survives independently; the occurrence becomes an unplaced recorded
  fact.
- **A planned row + fact is legal until regeneration.** The status/focus read
  reports `not-performed` truthfully in the meantime; `next`/`past-due` never
  include recorded occurrences, and `notPerformedRecorded` counts them.
- **The M15 unplaced projection** (authored occurrence with a current fact and
  no current planned row) is horizon-independent and date-independent, carries
  authored labels only, and invents no planned date. Undo does not change it —
  an occurrence with no row is simply open/unplaced.

## Follow-through semantics (M16, extended)

Full detail lives in `docs/follow-through.md`; the M17 deltas are:

- **One more outcome:** `resolveFollowThroughOutcome` gains `not-performed`,
  in locked precedence after `started` and before `past-due`; every occurrence
  now resolves to exactly one of **eight** outcomes. Not-performed normalizes
  to the single count `notPerformed`.
- **One more count:** the weekly summary carries **seven** integers —
  `planned`, `completed`, `completedEarly`, `completedLate`, `started`,
  `pastDue`, `notPerformed`. The implicit remainder is
  `today + upcoming = planned − completed − started − pastDue − notPerformed`.
- **The three-row occurrence projection:** a recorded fact with a current row
  appears in its week (normal completion + `notPerformed` count); with no row
  it contributes only to `notPerformedUnplaced` and never to weeks or totals;
  a completed occurrence with no row stays history-only and is never
  injected. `notPerformedUnplaced` is the **row-set difference** between
  recorded facts and **all** current planned rows — horizon-independent, and
  not a report of unperformed work.
- The M16 spine remains the current planned rows; M16 never appends an
  occurrence solely for the fact, holds the 8-week horizon constant, and adds
  no adherence percentage or second report.

## Run closure denominator

`resolveRunClosure`'s denominator is the run's **authored structure**:
`listScheduledWorkoutsInOrder` for the current program, minus completed ids
minus not-performed ids, with open occurrences reported in **authored order**.
The verdict is **not** derived from planned rows, the M15 calendar, the M16
horizon, dates, or any user-global history — so a run whose calendar
regenerated empty, or whose horizon leaves occurrences unplaced, still
concludes honestly. `openInProgramOrder` follows authored order exactly; a
zero-workout program is never concluded (there is no N that can ever exist for
it), and restart of an open run performs **zero** writes.

## Completion isolation (M14 vs M17)

M17 never touched the M14 completion surface:

- `GetProgramCompletionSummaryUseCase` still loads only the `isProgramComplete`
  authority (completion + authored structure) — it has no run-closure
  dependency, and the `/completed` route remains **completion-only**.
- A **concluded but incomplete** run: is restartable, shows the "Run closed"
  callout, and receives **no** completion summary, no "program complete"
  claim, and no completion-path redirect. Completion semantics require
  `isProgramComplete` exactly.
- Personal Records are created only from completed sessions with recorded work
  (`detectPersonalRecords` over `listCompletedTrainingHistory`); not-performed
  records can never mint a PR.
- `isProgramComplete` is byte-identical to its M14 form; conclusion is a second
  verdict computed from a second source, never a mode, preference, status
  column or cache, and the two verdicts are never merged.

## Decision authority and layer ownership

| Concern | Owner | Exact location |
|---|---|---|
| Closure verdict (`resolveRunClosure`, `isRunConcluded`, `isRunRestartable`, `openInProgramOrder`) | Domain | `src/domain/services/run-closure.ts` |
| Record/undo decisions (`decideRecordNotPerformed`, `decideUndoNotPerformed`) | Domain | `src/domain/services/not-performed-decision.ts` |
| Cross-checks (`assertOccurrenceSettlementIsConsistent`) | Domain | `src/domain/services/occurrence-settlement.ts` |
| Record/undo/start orchestration with caller-supplied `now` | Application | `record-not-performed`, `undo-not-performed`, `start-workout-session` use cases |
| Closure read + restart gate orchestration | Application | `get-run-closure-summary`, `restart-program` use cases |
| Enrollment-locked transaction: diagnostic reads, decision invocation, guarded delete, fact insert, session insert | Infrastructure | `src/infrastructure/database/repositories/drizzle-run-occurrence-writes.ts` |
| Read-only fact projection | Infrastructure | `drizzle-not-performed-occurrence-repository.ts` |
| Auth, validation, request-clock boundary; copy; forms | Presentation | Server Actions, `program-panel-state.ts`, `workout-cta-state.ts`, `schedule-week-view.ts` |

Presentation never decides settlement or closure: Server Actions own auth,
validation and the request clock, then delegate; the CTA state and panel state
resolve *display* rules from computed flags only.

## Final port table

| Port | Operations | Mutations allowed |
|---|---|---|
| `NotPerformedOccurrenceRepository` | `listByEnrollment` | **none** — read-only |
| `RunOccurrenceWriteRepository` | `recordNotPerformed`, `undoNotPerformed`, `createSessionForOccurrence` | the three settlement/creation writes only |
| `WorkoutSessionRepository` | `save`, `listCompletedWorkoutSessionsByEnrollment`, `findActiveSessionByScheduledWorkout`, `findActiveSessionForEnrollment`, `listActiveSessionsByEnrollment`, `listSessionsByScheduledWorkout`, `listCompletedSessionsByScheduledWorkout`, `listSessionSummaries`, `listSessionSummariesByEnrollment`, `findSessionWithDetail`, `listInProgressTrainingHistory`, `findActiveWorkoutSession` | **update only** — no create/upsert of a session row |
| `PersonalRecordRepository` | read-side queries | **none** — read-only (M12 boundary) |

`RunOccurrenceWriteRepository` is the **only** port declaring the three
settlement operations; no other port interface or read port may declare them.

## Error contract

All business failures are typed Results surfaced to inline copy; only an
infrastructure failure reaches the error boundary.

| Use case | Code | Class | Copy / behavior |
|---|---|---|---|
| Record | `INVALID_INPUT` | validation | invalid ids / dates |
| Record | `PROGRAM_NOT_FOUND`, `SCHEDULED_WORKOUT_NOT_FOUND`, `NOT_ENROLLED` | absence | not-found / forbidden refusal |
| Record | `OCCURRENCE_ALREADY_RECORDED` | conflict | "This workout is already recorded as not performed." |
| Record | `OCCURRENCE_ALREADY_PERFORMED` | conflict | "This workout is already completed, so it cannot be recorded as not performed." |
| Record | `OCCURRENCE_HAS_LOGGED_WORK` | conflict | "This workout has logged work, so it cannot be recorded as not performed." |
| Record | `ENROLLMENT_CHANGED` | stale | "Your enrollment changed while saving. Please reload and try again." |
| Record | — | invariant → infrastructure | `NotPerformedWriteContractViolationError` thrown → rollback |
| Undo | `INVALID_INPUT` / `PROGRAM_NOT_FOUND` / `SCHEDULED_WORKOUT_NOT_FOUND` / `NOT_ENROLLED` | validation / absence | as above |
| Undo | `OCCURRENCE_NOT_RECORDED` | conflict | "This workout is not recorded as not performed." |
| Undo | `ENROLLMENT_CHANGED` | stale | as above |
| Start | `OCCURRENCE_RECORDED_NOT_PERFORMED` | conflict | `Scheduled workout "…" was recorded as not performed` — zero writes |
| Start | `SESSION_ALREADY_EXISTS`, `NOT_ENROLLED`, `PROGRAM_NOT_FOUND`, `SCHEDULED_WORKOUT_NOT_FOUND`, `ENROLLMENT_CHANGED`, `INVALID_WORKOUT_SESSION` | absence / stale / conflict | unchanged M12 semantics |
| Restart | `PROGRAM_NOT_COMPLETE` | absence | open run — application copy "This run hasn't finished yet." |
| Restart | `ALREADY_ENROLLED`, `ENROLLMENT_CHANGED`, `NOT_ENROLLED` | conflict / stale | unchanged M14 semantics |

`ScheduleActionErrorCode` carries the `OCCURRENCE_*` codes and
`ENROLLMENT_CHANGED`; action errors render inline with `role="alert"` through
`ScheduleActionError` — identical to every other schedule action failure.
There is no toast system.

## Presentation state matrix

| State | Surface | Affordance | Copy | Undo |
|---|---|---|---|---|
| Calendar slot `planned` / `past-due` | `ScheduleWeekView` (`schedule-week-view.ts`) | Move disclosure + record form | "Didn't train this"; motion-sensitive disclosure warns recording removes an empty in-progress workout | — |
| Calendar slot `in-progress` | `ScheduleWeekView` | record form (Move hidden) | "Didn't train this"; "Recording removes the empty workout you have in progress." | — |
| Calendar slot `not-performed` | `ScheduleWeekView` | undo form (start/move hidden) | "Recorded as not performed"; "It goes back to not started." | yes |
| Calendar slot `completed` | `ScheduleWeekView` | no settlement control | "Completed" | — |
| Unplaced recorded list | `ProgramScheduleSection` | per-row undo form, no date | heading "Recorded as not performed"; body "These workouts are recorded as not performed and have no calendar date right now." | yes |
| Workout detail CTA band | `WorkoutStartPanel` (`ctaState: 'not-performed'`) | undo form; Start suppressed | "Recorded as not performed"; "It goes back to not started." | yes |
| Scheduled workout card | `ProgramDetailSection` | status text only | "Recorded as not performed" | via detail |
| Follow-through week row | `PlanFollowThroughSection` | none (read-only report) | "n not performed" fragment; totals line includes "n not performed"; unplaced pointer "recorded as not performed without a calendar date — see Training schedule" | via calendar |
| Concluded run panel | `EnrolledProgramPanel` (`ConcludedRunCallout`) | restart button iff `restartAvailable`; never links `/completed` | "Run closed — {completed} completed, {notPerformed} recorded as not performed" (both counts always rendered) | — |
| Restart refusal | Restart form | — | `PROGRAM_NOT_COMPLETE` → "This run hasn't finished yet." | — |

No confirmation dialogs anywhere — Undo is the safety mechanism — and no bulk
settlement action exists (grep-locked). All copy is literal in tests; there is
no i18n layer.

## Tests & acceptance evidence

The evidence lives in the suites themselves; this is the map.

| Layer | Suite | Proves |
|---|---|---|
| Domain | `tests/unit/domain/services/run-closure.test.ts` | closure/restartability verdicts; `isProgramComplete` byte-identical to M14 |
| Domain | `tests/unit/domain/services/not-performed-decision.test.ts` | record/undo decision tables, zero-write refusals |
| Domain | `tests/unit/domain/services/schedule-focus.test.ts`, `plan-follow-through.test.ts`, `planned-schedule-not-performed.test.ts`, `schedule-follow-through-parity.test.ts` | settlement consistency cross-check, eight outcomes, settled-excluded generation, parity |
| Application | `use-cases/record-not-performed.test.ts`, `undo-not-performed.test.ts`, `start-workout-session.test.ts`, `get-run-closure-summary.test.ts`, `restart-program.test.ts`, `get-enrollment-schedule.test.ts`, `get-enrollment-follow-through.test.ts`, `configure-training-days.test.ts` | use-case semantics, error unions, restart gate, caller-supplied `now` |
| Presentation | `features/schedule/*`, `features/sessions/workout-cta-state.test.ts`, `workout-start-panel.test.ts`, `features/enrollment/program-panel-state.test.ts`, `enrolled-program-panel.test.ts`, `restart-action.test.ts` | literal copy, state matrices, action errors, no confirmation step |
| Architecture | `tests/unit/architecture/run-closure.test.ts`, `session-creation-authority.test.ts`, `schedule-not-performed.test.ts`, `settlement-presentation.test.ts`, `follow-through.test.ts` + the Slice 13 final-guard suite | port shapes, mutation authority, verdicts unpersisted, no bulk/confirm, no run archive |
| Integration | `not-performed-occurrence-repository.test.ts`, `not-performed-settlement.test.ts`, `session-creation-serialized.test.ts`, `not-performed-schedule.test.ts`, `follow-through-round-trip.test.ts` | port contracts, cross-table serialization, round-trip projections |
| Integration | `not-performed-concurrency.test.ts` (race matrix + statement/lock discipline + version-pin proven by test 9c), `not-performed-lifecycle.test.ts`, `not-performed-historical-truth.test.ts` | EPQ race matrix, no-retry/lock-first discipline, leave/restart cascade truth |

Full verification for Slice 13: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:integration`, `pnpm build` — all green on this commit.

## Commit chain (milestone_17)

| # | Commit |
|---|---|
| 1 | `cbe18fd` feat(domain): add the not-performed fact, run conclusion and restartability (M17 Slice 1) |
| 2 | `afc80b4` fix(domain): reject contradictory run settlements |
| 3 | `e93af4e` feat(domain): teach schedule and follow-through taxonomies the not-performed fact (M17 Slice 2) |
| 4 | `25da7d1` feat(database): add not_performed_workouts persistence and read repository (M17 Slice 3) |
| 5 | `f734470` refactor(database): split workout session create from update so writes cannot resurrect deleted rows (M17 Slice 4) |
| 6 | `d762103` feat(database): add serialized not-performed settlement writes (M17 Slice 5) |
| 7 | `7f9e293` feat(database): serialize workout session creation with run settlement (M17 Slice 6) |
| 8 | `cc03ca6` feat(application): add not-performed record and undo use cases (M17 Slice 7) |
| 9 | `623eba6` feat(schedule): project not-performed facts into the current calendar (M17 Slice 8) |
| 10 | `c4a3cc9` feat(follow-through): include not-performed facts without changing the report horizon (M17 Slice 9) |
| 11 | `7db529c` feat(programs): add run closure summary and restart concluded runs (M17 Slice 10) |
| 12 | `5a9c393` feat(schedule): expose honest run settlement and closure controls (M17 Slice 11) |
| 13 | `a87246c` test(m17): prove settlement concurrency lifecycle and historical truth (Slice 12) |
| 14 | this document — docs(m17): document run closure and settlement invariants (Slice 13) |

No push and no pull request are part of Slice 13.
