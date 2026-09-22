# Session Composition: Add & Remove Exercise (M11)

M11 lets a user **compose** an in-progress workout session: explicitly **add**
an exercise from the existing catalog to that session only, and **remove** an
exercise they added. The authored Program/Workout **template is never
touched** — composition lives entirely in the session snapshot.

This document is the canonical reference for the feature: domain semantics,
persistence, application orchestration, UI affordances, history truthfulness,
interactions with M8/M9/M10, and testing. Sibling features:

- [`docs/exercise-substitution.md`](exercise-substitution.md) — M9 substitution/restore
- [`docs/session-adjustments.md`](session-adjustments.md) — M10 skip/unskip and adjacent reorder

Everything below describes shipped behavior — the code is the final authority,
and each section points to its implementation.

---

## Contents

1. [Overview & product intent](#1-overview--product-intent)
2. [Occurrence provenance](#2-occurrence-provenance)
3. [Identity: authored vs performed, order vs occurrenceKey, high-water mark](#3-identity-authored-vs-performed-order-vs-occurrencekey-high-water-mark)
4. [Add semantics (domain)](#4-add-semantics-domain)
5. [The explicit Add-time prescription](#5-the-explicit-add-time-prescription)
6. [Remove semantics (domain)](#6-remove-semantics-domain)
7. [Removal eligibility projection](#7-removal-eligibility-projection)
8. [Application orchestration (use cases)](#8-application-orchestration-use-cases)
9. [Concurrency & stale rendered intent](#9-concurrency--stale-rendered-intent)
10. [Persistence model](#10-persistence-model)
11. [Progress & completion](#11-progress--completion)
12. [M8 progression interaction](#12-m8-progression-interaction)
13. [M9 substitution interaction](#13-m9-substitution-interaction)
14. [M10 adjustment interaction](#14-m10-adjustment-interaction)
15. [Completed-history truthfulness](#15-completed-history-truthfulness)
16. [UI: Active Workout composition](#16-ui-active-workout-composition)
17. [Out of scope](#17-out-of-scope)
18. [Testing map](#18-testing-map)

---

## 1. Overview & product intent

- **Who can compose:** the session owner, on an **in-progress** session they
  are still enrolled in. Completed and detached (left-program) sessions are
  immutable history.
- **Add** appends one occurrence for an exercise the user explicitly picks from
  the existing catalog. It never reorders anything: M10's adjacent Move Up/Down
  is still the only repositioning mechanism.
- **Remove** deletes an occurrence **the user added** — and only that. Template
  occurrences are removed from a session only through Skip/Unskip.
- **Why:** a 40+ athlete legitimately wants a variation mid-workout (a free
  machine, a nagging shoulder, an extra accessory) without rewriting the
  program, and without losing the truthful record of what was actually done.

**Template immutability is the core invariant.** Neither Add nor Remove writes
`training_programs`, `workouts`, `workout_exercises` or `scheduled_workouts`;
they mutate the `WorkoutSession` aggregate and persist it through the existing
whole-aggregate `save`.

Implementation: `src/domain/services/session-exercise-composition.ts`,
`src/application/use-cases/add-session-exercise.ts`,
`src/application/use-cases/remove-session-exercise.ts`.

---

## 2. Occurrence provenance

Every occurrence carries an explicit, persisted provenance:

```ts
type OccurrenceSource = 'template' | 'user_added';
```

(`OccurrenceSource` in `src/domain/entities/workout-session.ts`.)

- `'template'` — the occurrence came from the authored workout template.
- `'user_added'` — the user explicitly added it during this session (M11).

Rules:

- **Persisted, never inferred.** Provenance is a stored fact. It is never
  derived from `exerciseOrder`, `occurrenceKey`, `authoredExerciseId`,
  `performedExerciseId`, substitution state or history position.
- **Defaults to `'template'`.** Fresh sessions omit it and the factory defaults
  it; existing and legacy rows (written before the column existed) hydrate as
  template-authored via the column default.
- **Survives everything.** The whole-aggregate rewrite persists it verbatim, so
  it travels with the occurrence through reorder, skip/unskip,
  substitution/restore, set mutations, save/reload and completion.

Presentation derives its provenance treatment through one pure helper
(`resolveOccurrenceProvenanceLabel` in
`src/features/sessions/session-provenance-views.ts`), shared by Active Workout
and completed history, so there is exactly one source-to-label mapping.

---

## 3. Identity: authored vs performed, order vs occurrenceKey, high-water mark

| Concept | Field | Nature |
|---|---|---|
| Business locator | `(sessionId, exerciseOrder)` | **Mutable address**. Every command addresses an occurrence by it. |
| Authored exercise | `ExerciseLog.authoredExerciseId` | The occurrence's **contract** identity. For a template occurrence: the template's exercise. For a user-added occurrence: **the exercise the user added**. Never rewritten by substitution. |
| Performed exercise | `ExerciseLog.performedExerciseId` | What was actually trained. Substitution rewrites only this. |
| Provenance | `ExerciseLog.source` | `'template'` or `'user_added'`. |
| Render identity | `ExerciseLog.occurrenceKey` | Immutable, session-unique **token**, never an address. |
| High-water mark | `WorkoutSession.nextOccurrenceKey` | Session-level monotonic counter; the next `occurrenceKey` to hand out. |

`occurrenceKey` exists only so React state can travel with an occurrence
through a reorder/renumber. It is **never** an input to a use case, Server
Action or Zod schema, never a query predicate, and never part of
history/progression identity. `nextOccurrenceKey` is a counter (like `version`),
not an identity: it is never exposed on a DTO, an action or a form.

See [`docs/session-adjustments.md` §2](session-adjustments.md#2-occurrence-identity)
for the reorder-stability rationale that introduced `occurrenceKey`.

---

## 4. Add semantics (domain)

`addSessionExercise(session, { exerciseId, prescription, restSeconds })` in
`src/domain/services/session-exercise-composition.ts`:

- Available **only while the session is in progress**
  (`SESSION_ALREADY_COMPLETED` otherwise).
- Appends **exactly one** occurrence at the END of the canonical order
  (`order = current N + 1`), so the returned aggregate is canonical: array
  position agrees with order.
- The new occurrence is created with:
  - `authoredExerciseId = performedExerciseId = exerciseId` — the user's
    explicit choice is both the occurrence's contract and its performed
    identity until a substitution changes the latter;
  - `source = 'user_added'`;
  - `occurrenceKey = session.nextOccurrenceKey`;
  - `isSkipped = false`, `sets = []`;
  - the caller's explicit `prescription` and `restSeconds`, verbatim.
- The returned aggregate has `nextOccurrenceKey = previous + 1`. Every existing
  occurrence — order, keys, provenance, sets — is untouched.
- **Duplicate exercises are valid**: identity is per occurrence, so the same
  `ExerciseId` may appear many times, including adding one already present.
- The source aggregate is never mutated.

The service accepts only `exerciseId`, `prescription` and `restSeconds`. The
order, the occurrence key, the new high-water mark, the provenance, the
performed identity and the skip/set state are **derived** — they are not inputs.

---

## 5. The explicit Add-time prescription

A user-added occurrence has **no authored workout prescription**, so the user
explicitly chooses one at Add time (M11 locked product decision):

| Scheme | Client input | Persisted as |
|---|---|---|
| Reps | `sets`, `targetReps` | `{ type: 'reps', sets, minReps: targetReps, maxReps: targetReps }` |
| Duration | `sets`, `durationSeconds` | `{ type: 'duration', sets, seconds: durationSeconds }` |

- Construction goes through the existing domain value-object factories
  (`createRepScheme` / `createDurationScheme`), which own the positive-integer
  invariants. Malformed boundary input is rejected as `INVALID_INPUT` before
  persistence.
- The transport boundary is a discriminated union on `scheme`, so a duration
  payload cannot carry `targetReps` and a reps payload cannot carry
  `durationSeconds` — the non-matching field is stripped by the schema and can
  never drive the persisted prescription.
- There is **no catalog default, no "3×10" default, no exercise-type inference
  and no AI-generated prescription**. Prefer empty explicit fields over
  implied coaching.
- **`restSeconds = 0` is an explicit product rule**: a session-added occurrence
  has no authored/template rest prescription. It is fixed server-side
  (`SESSION_ADDED_REST_SECONDS`) and is **not** a client or application input.
  History renders `0` as "no rest prescribed".

Implementation: `src/application/use-cases/add-session-exercise-prescription.ts`.

---

## 6. Remove semantics (domain)

`removeSessionExercise(session, { exerciseOrder })` in
`src/domain/services/session-exercise-composition.ts`:

Guards run in this locked order:

| # | Condition | Outcome |
|---|---|---|
| 1 | Session completed | `SESSION_ALREADY_COMPLETED` |
| 2 | Unknown `exerciseOrder` | `EXERCISE_LOG_NOT_FOUND` |
| 3 | `source !== 'user_added'` | `EXERCISE_NOT_REMOVABLE` |
| 4 | The occurrence has ≥ 1 logged set | `EXERCISE_HAS_LOGGED_SETS` |
| 5 | Otherwise | the occurrence is removed |

**Logged-set guard (no silent data loss).** An occurrence with logged work is
never removed implicitly; the user deletes those sets explicitly first. Nothing
is discarded or relabelled behind their back.

**Skipped user-added occurrence:** removable directly — no unskip required. A
skipped occurrence carries zero sets by invariant, so the logged-set guard
never co-occurs, and removal discards nothing.

**Substituted user-added occurrence:** removable directly — no restore
required. Removal discards the whole occurrence and relabels nothing, so
provenance alone gates removal; the performed identity is irrelevant to it.

**Template-authored occurrence:** never removable. Skip/Unskip remains its
session-level exclusion mechanism (the template is immutable).

After a successful removal:

- the survivors are renumbered densely `1..N` with array position agreeing with
  order (canonical);
- every surviving occurrence keeps its `occurrenceKey`, `source`,
  `authoredExerciseId`/`performedExerciseId`, prescription, rest, skip decision
  and logged sets;
- `nextOccurrenceKey` is **not** touched — see §10;
- the source aggregate is never mutated (`filter` allocates a fresh array
  before the renumber).

At least one occurrence always survives: a session always starts with at least
one **template** occurrence (the aggregate factory rejects zero logs) and
template occurrences are never removable, so removal can never yield an empty
occurrence list.

---

## 7. Removal eligibility projection

`resolveOccurrenceRemovalEligibility(session, log)` exposes the mutation's rules
as a read-only projection:

```ts
{
  canRemove: boolean;
  blockedBy: 'session-completed' | 'template-authored' | 'logged-sets' | null;
}
```

- Precedence: **`session-completed` > `template-authored` > `logged-sets`**.
  A template occurrence with logged sets therefore reports
  `'template-authored'`, not `'logged-sets'`.
- One canonical block function drives both the mutation and the projection, so
  they cannot disagree (a domain test asserts their agreement for every state).
- Persistence, DTOs and presentation consume this projection; **nobody
  re-derives removability from `source` or raw set counts**. React components
  must never write `source === 'user_added' && sets.length === 0`.
- `source` stays independently available on the DTO for truthful provenance
  rendering — provenance and removability are separate concerns.

---

## 8. Application orchestration (use cases)

Two use cases, both following the M9/M10 mutation guard chain:

1. **`AddSessionExerciseUseCase`** (`src/application/use-cases/add-session-exercise.ts`)
   - Input: `sessionId`, `userId`, `exerciseId`, `scheme`, `sets`,
     `targetReps` **or** `durationSeconds`, `expectedSessionVersion`.
   - Chain: validate ids/input → load → ownership (`FORBIDDEN`) → enrollment
     (`NOT_ENROLLED`) → stale intent (`SESSION_MODIFIED`) → **targeted catalog
     existence** via `ExerciseRepository.findByIds([exerciseId])`
     (`EXERCISE_NOT_FOUND`) → build the explicit prescription → domain →
     whole-aggregate save → DTO from the **persisted** aggregate.
   - Selection uses the stable `ExerciseId`, never an order.
2. **`RemoveSessionExerciseUseCase`** (`src/application/use-cases/remove-session-exercise.ts`)
   - Input: `sessionId`, `userId`, `exerciseOrder`, `expectedSessionVersion`.
   - Chain: validate → load → ownership → enrollment → **stale intent, BEFORE
     `exerciseOrder` is interpreted** → domain → save → DTO from the persisted
     aggregate.

Neither accepts `occurrenceKey`, `source`, `nextOccurrenceKey`, the authored or
performed identity, or (for Add) `restSeconds`. Expected failures are returned
as typed `Result` data; unexpected errors throw.

The `userId` always comes from the trusted authenticated session at the
presentation layer, never from client input.

---

## 9. Concurrency & stale rendered intent

- Every save bumps the row `version`; a save whose version no longer matches
  throws `SessionStaleVersionError`, mapped to `SESSION_MODIFIED`.
- **Stale rendered intent:** `exerciseOrder` is mutable, so a tab rendered
  before a concurrent reorder holds an order that now identifies a *different*
  occurrence. Every composition command carries `expectedSessionVersion` (the
  rendered snapshot's `version`), and the use case compares it against the
  freshly loaded aggregate **before** any mutation.
  - For **Remove** this ordering is essential: a stale browser must never
    remove whichever occurrence currently occupies an old `exerciseOrder`.
    A regression test proves the current occupant stays untouched.
  - For **Add** the guard is applied for uniformity; there is no order to
    misread, but a stale tab still gets the same honest `SESSION_MODIFIED`.
- The shared guard lives in
  `src/application/use-cases/session-version-guard.ts`.
- Both use cases build their DTO from the aggregate returned by `save()`, so the
  returned `version` is the **committed** one and a chained follow-up mutation
  can reuse it without a false `SESSION_MODIFIED`.

---

## 10. Persistence model

M11's schema changes are migration `0012_dazzling_tigra`:

```sql
ALTER TABLE "exercise_logs" ADD COLUMN "source" text DEFAULT 'template' NOT NULL;
ALTER TABLE "workout_sessions" ADD COLUMN "next_occurrence_key" integer;
ALTER TABLE "exercise_logs" ADD CONSTRAINT "exercise_logs_source_check"
  CHECK ("exercise_logs"."source" IN ('template', 'user_added'));
```

- **`exercise_logs.source`** — `NOT NULL DEFAULT 'template'` plus the enum
  CHECK. Existing rows are template-authored by construction; **no backfill
  needed**. It is never part of the composite PK or the `set_logs` FK.
- **`workout_sessions.next_occurrence_key`** — nullable `integer`, **no default,
  no backfill**. A legacy row hydrates through the domain fallback
  `max(occurrenceKey) + 1`, which is safe because only a session that has
  performed a removal has a persisted mark. It rides the session row like
  `version`: `mapSessionToRow` persists it and the upsert's `set` clause updates
  it on every whole-aggregate save.
- **Occurrence-key uniqueness backstop** — the partial unique index
  `exercise_logs_session_occurrence_key_unique` on
  `(session_id, occurrence_key) WHERE occurrence_key IS NOT NULL` (migration
  `0011`) still guards the domain's session-unique `occurrenceKey` invariant; the
  repository maps its violations BY NAME to
  `SessionOccurrenceKeyConflictError`. Rows written before the column existed
  hydrate with `occurrenceKey ?? exerciseOrder` and self-heal on the next save.
- The business locator stays the composite PK `(session_id, exercise_order)`
  with the `set_logs` composite FK on that pair. The repository's
  delete-and-reinsert child strategy and its optimistic-concurrency/enrollment
  predicates are unchanged.

### The high-water policy (why the mark, not `max + 1`)

`occurrenceKey` must stay **session-unique and never reused**. After a removal,
`max(existing occurrenceKey) + 1` would hand a new occurrence the **removed**
key — and React would then resurrect the discarded occurrence's subtree state
(logger draft, open disclosure). The session-level monotonic
`nextOccurrenceKey` is therefore the only safe key source:

- `createWorkoutSession` initialises it to `max(occurrenceKey) + 1`.
- `addSessionExercise` consumes it and advances it by one.
- `removeSessionExercise` **never decrements** it.
- The factory rejects a mark that is not a positive integer strictly greater
  than every existing `occurrenceKey`.

A removed occurrence key is therefore never reusable, and a subsequent Add
takes the current high-water mark. Integration tests prove the chain
add → remove → add across a save/reload.

---

## 11. Progress & completion

M11 changes **nothing** about the progress/completion rules; user-added
occurrences are ordinary occurrences in the aggregate:

- **Progress denominator** — `resolveSessionPrescriptionTotals` sums
  `prescription.sets` across **non-skipped** occurrences. A non-skipped
  user-added occurrence contributes its explicitly chosen sets; a skipped
  user-added occurrence contributes nothing.
- **Progress numerator** — `calculateSessionMetrics` counts actual logged sets,
  including those logged on a user-added occurrence.
- **Completion** — `resolveSessionCompletionReadiness` (≥ 1 logged set anywhere)
  is unchanged. A user-added occurrence with logged work satisfies it on its
  own; an all-skipped or zero-work session stays non-completable
  (`CANNOT_COMPLETE_EMPTY_SESSION`).
- A **zero-set non-skipped** occurrence (template or user-added) participates in
  the denominator but not the numerator and never implies skipped.

Removing a zero-set user-added occurrence returns the totals to the remaining
composition (the removed occurrence's prescribed sets leave the denominator).

---

## 12. M8 progression interaction

User-added performed work participates in user-global progression exactly like
any other performed occurrence:

- History and progression reads key on the **performed** `ExerciseId` joined to
  `set_logs` existence, so a user-added occurrence with logged work appears in
  its performed exercise's history and in
  `listRecentCompletedExercisePerformances`.
- The Active Workout's target request already includes every non-skipped
  occurrence using `{ performedExerciseId, prescription }`, so a user-added
  occurrence gets a recommendation computed from its history and the
  **user-chosen** prescription.
- **Recommendations never overwrite user input**: M8 supplies a prefill/advice;
  the persisted prescription is the user's choice.
- A zero-set or skipped user-added occurrence never enters the progression
  window, so it can never shadow or pollute a real performance.
- `0 kg` stays a real external load distinct from `null` (bodyweight), exactly
  as before.

No M8 engine code was changed by M11.

---

## 13. M9 substitution interaction

A user-added occurrence participates in substitution with **no ambiguity**,
because its authored identity is the exercise the user added:

- `substituteSessionExercise` rewrites only `performedExerciseId`.
- `restoreSessionExercise` returns `performed := authored` — i.e. back to **the
  exercise the user added**, even after a chained substitution.
- `source` remains `'user_added'` through substitution, restore, reorder,
  skip/unskip, save/reload and completion.
- Candidates are computed per **performed** id, which is correct for user-added
  occurrences too.
- A substituted user-added occurrence with logged sets belongs to the
  **replacement** exercise's history and progression — never to the originally
  added exercise.

M9 guards and candidate selection are unchanged.

---

## 14. M10 adjustment interaction

Provenance and the render token travel with the occurrence through every M10
adjustment:

- **Move Up/Down** swaps whole occurrences: `source`, `occurrenceKey`,
  prescription, rest, skip decision and logged sets move together.
- **Skip/Unskip** flips only `isSkipped`; `source` and `occurrenceKey` are
  untouched.
- `nextOccurrenceKey` is unaffected by reorder, skip and unskip — only Add
  advances it.
- `exerciseOrder` remains the mutable business locator; `occurrenceKey` remains
  render/persistence identity only.
- A skipped user-added occurrence still moves, and skip/unskip/move remain
  available for user-added occurrences exactly as for template ones.

M10 semantics are unchanged.

---

## 15. Completed-history truthfulness

The completed-session detail (`src/features/history/`) preserves and displays
provenance:

- A completed user-added occurrence appears in its **final persisted order**
  with the subtle neutral label **"Added during workout"**, derived only from
  the persisted `source` (via the shared
  `resolveOccurrenceProvenanceLabel` helper — one mapping for both screens).
- Template occurrences get no provenance label.
- **User-added + substituted:** the performed exercise stays the primary
  identity, the "Originally: …" line names the authored (i.e. originally added)
  exercise, and "Added during workout" stays visible.
- **User-added + skipped:** the occurrence stays visible, renders the existing
  neutral Skipped state (no set rows, no fabricated metrics, **no
  performance-history link**) and keeps the provenance label.
- **Zero-set non-skipped** stays distinct from skipped: it keeps the
  "No sets were logged." line and the performance link.
- History exposes **no mutation controls** — no Remove, Skip, Move, Substitute
  or logger.

Per-exercise history and progression attribute work by the **performed**
`ExerciseId`: a user-added occurrence with logged work participates normally, a
zero-set or skipped one creates no occurrence, and a substituted one belongs to
the replacement exercise only.

---

## 16. UI: Active Workout composition

- **Add** (`AddSessionExercisePanel`, client boundary): a native `<details>`
  disclosure containing a **display-only** search field (outside the `<form>`,
  so typing never submits), the catalog as **controlled** native radio cards (no
  pre-selection, duplicates allowed), an explicit Reps/Duration choice, and
  explicitly **empty** sets/target fields. Submission is a native form through
  `useActionState` and the shared `createSessionMutationSubmit`.
- **One owner for the draft:** the panel owns the whole user-visible Add draft
  (`add-exercise-draft.ts`: `exerciseId`, `scheme`, `sets`, `targetReps`,
  `durationSeconds`) as a single controlled state object; the catalog and
  prescription children are presentational views over it, so the draft can
  never be split between DOM state and component state. An expected failure
  (`VALIDATION_ERROR`, `INVALID_INPUT`, `EXERCISE_NOT_FOUND`, `SESSION_MODIFIED`,
  `SESSION_ALREADY_COMPLETED`, `NOT_ENROLLED`, …) preserves the COMPLETE draft;
  success clears it as one unit, so the next Add must state a fresh explicit
  prescription (never a default, never a stale one). Because React 19's
  post-action `form.reset()` returns controlled radios to their mount-time
  `defaultChecked` (facebook/react#31695), the panel re-asserts its draft to the
  DOM after each resolved action instead of letting the reset partially clear
  the visible selection. Search text is display-only and NOT part of the draft.
- The catalog comes from the Active Workout's **single** exercise-catalog read
  (`GetActiveWorkoutExerciseDataUseCase.addableExercises`) — no second query,
  no N+1, and exercises already present stay addable.
- **Remove** (`SessionRemovalControl`, client boundary): renders the quiet
  "Remove exercise" control when `removalEligibility.canRemove`, the truthful
  muted copy "Delete your logged sets to remove this exercise." when
  `blockedBy === 'logged-sets'`, and **nothing** for `template-authored` or
  `session-completed`. It is reachable from both the full card and the compact
  "Up next" expand (a just-added occurrence lives in the latter until touched).
- Refresh/error handling reuses the centralized
  `shouldRefreshAfterSessionMutationError` predicate: `SESSION_MODIFIED`,
  `SESSION_ALREADY_COMPLETED`, `NOT_ENROLLED` and `EXERCISE_HAS_LOGGED_SETS`
  reload; `INVALID_INPUT`, `EXERCISE_NOT_FOUND`, `EXERCISE_LOG_NOT_FOUND` and
  `EXERCISE_NOT_REMOVABLE` surface truthful copy without a reload.
  `EXERCISE_NOT_REMOVABLE` is never silently converted into a Skip.
- **React identity:** every occurrence renders through the single keyed
  `SessionOccurrence` boundary keyed `occ:${occurrenceKey}`. Adding or removing
  an occurrence therefore never remounts or misassociates a survivor — a
  survivor that renumbers (3 → 2) keeps its React key, logger draft and
  disclosure.

---

## 17. Out of scope

M11 deliberately does **not** include:

- **Arbitrary reorder** (jump to any position) or **drag/drop** — adjacent
  Move Up/Down only.
- **Editing the Program/Workout template** — composition is session-only.
- **User-created custom exercises** — only existing catalog exercises can be
  added.
- **AI exercise suggestions** and **AI prescription generation**.
- **Supersets / circuits / exercise grouping.**
- **Automatic equipment suitability, medical or injury recommendations.**
- **Bulk add**, and **add-from-history** shortcuts.
- **Persisted workout drafts** outside the existing session persistence.
- **Removing template-authored occurrences** — Skip/Unskip remains their
  mechanism.
- **Changing M8/M9/M10 semantics, program progress, or the repository's
  persistence strategy.**

---

## 18. Testing map

| Behavior | Layer | Test file |
|---|---|---|
| Add: append position, provenance, canonical order, high-water advance, duplicate ids, completed block | Domain (unit) | `tests/unit/domain/services/session-exercise-composition.test.ts` |
| Remove: guards, dense renumber, surviving keys, high-water untouched, skipped/substituted removal, duplicate ids, source immutability, eligibility agreement + precedence | Domain (unit) | `tests/unit/domain/services/session-exercise-composition.test.ts` |
| Provenance/occurrenceKey/high-water survival through substitute, restore, chained substitution, reorder, skip/unskip, completion | Domain (unit) | `tests/unit/domain/services/session-composition-interactions.test.ts` |
| Progress denominator/numerator and completion with user-added occurrences (mixed cases A–E, all-skipped, zero-work) | Domain (unit) | `tests/unit/domain/services/session-composition-progress.test.ts` |
| Factory: `source` default, `nextOccurrenceKey` default/validation, duplicate-key rejection | Domain (unit) | `tests/unit/domain/entities/workout-session.test.ts` |
| Add/Remove guard chains, ownership/enrollment/stale intent, persisted DTO + committed version | Application (unit) | `tests/unit/application/use-cases/add-session-exercise.test.ts`, `remove-session-exercise.test.ts` |
| `source`, `removalEligibility` and completed-entry `source` DTO projections | Application (unit) | `tests/unit/application/dto/workout-session.test.ts` |
| `addableExercises` from ONE catalog read; candidates unchanged | Application (unit) | `tests/unit/application/use-cases/get-active-workout-exercise-data.test.ts` |
| Add/Remove action schemas (no `occurrenceKey`/`nextOccurrenceKey`/`source`/`userId` authority) | Presentation (unit) | `tests/unit/features/sessions/session-actions-schema.test.ts` |
| Add/Remove actions: trusted identity, delegation, revalidation, error mapping, rethrow | Presentation (unit) | `tests/unit/features/sessions/add-exercise-actions.test.ts`, `remove-exercise-actions.test.ts` |
| Add panel flow (search/selection/scheme/fields/pending/errors/empty) + one-owner draft (failure preserves the complete draft, success clears it, no stale prescription on the next Add) | Presentation (unit) | `tests/unit/features/sessions/add-session-exercise-panel.test.ts` |
| Remove control states + refresh semantics; card affordances | Presentation (unit) | `tests/unit/features/sessions/session-removal-control.test.ts`, `session-exercise-card.test.ts` |
| Provenance mapping + card/upcoming rendering; render identities across append/remove | Presentation (unit) | `tests/unit/features/sessions/session-provenance-views.test.ts`, `session-occurrence-band-crossing.test.ts` |
| Completed-history provenance rendering (template/substituted/skipped/zero-set) | Presentation (unit) | `tests/unit/features/history/completed-session-view.test.ts`, `completed-session-entry-list.test.ts` |
| `source` + `next_occurrence_key` round-trip, legacy hydration, uniqueness backstop | Integration | `tests/integration/database/workout-session-provenance.test.ts` |
| Add/Remove persisted whole-aggregate behavior, dense orders, surviving keys, marked never reused, logged-set protection, unique-index validity | Integration | `tests/integration/database/workout-session-removal.test.ts` |
| User-added occurrences in per-exercise history, progression windows, completed detail and program progress | Integration | `tests/integration/database/training-history-repository.test.ts` |

Implementation entry points: `src/domain/services/session-exercise-composition.ts`
(domain rules), `src/application/use-cases/add-session-exercise.ts` +
`add-session-exercise-prescription.ts` + `remove-session-exercise.ts`
(orchestration), `src/application/dto/{workout-session,completed-session,training-history}.ts`
(projections), `src/features/sessions/` (actions, schema, views, UI) and
`src/features/history/` (completed-history truth).
