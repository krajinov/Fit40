# Exercise Substitution (M9)

Session-scoped exercise substitution lets a user swap the exercise they are
actually going to perform for one occurrence of an in-progress workout session,
without touching the program template or the authored prescription. This
document is the canonical reference for the feature: domain semantics,
persistence, candidate selection, application orchestration, UI, history
truthfulness, and testing.

Substitution is one of several session adjustments: skip/unskip and adjacent
reorder (M10) are sibling features with their own canonical reference,
[`docs/session-adjustments.md`](session-adjustments.md).

Everything below describes shipped behavior — the code is the final
authority, and each section points to its implementation.

---

## Contents

1. [Overview & product intent](#1-overview--product-intent)
2. [Domain model: authored vs. performed identity](#2-domain-model-authored-vs-performed-identity)
3. [Substitution & restore semantics (domain service)](#3-substitution--restore-semantics-domain-service)
4. [Candidate selection (tier ranking)](#4-candidate-selection-tier-ranking)
5. [Application orchestration (use cases)](#5-application-orchestration-use-cases)
6. [Persistence model](#6-persistence-model)
7. [History & progression truthfulness](#7-history--progression-truthfulness)
8. [UI: Active Workout swap panel](#8-ui-active-workout-swap-panel)
9. [UI: History "Originally: …" context](#9-ui-history-originally--context)
10. [Program progress](#10-program-progress)
11. [Legacy data (pre-M9 rows)](#11-legacy-data-pre-m9-rows)
12. [Testing map](#12-testing-map)

---

## 1. Overview & product intent

- **Who can substitute:** the session owner, on an **in-progress** session
  they are still enrolled in. Completed sessions and detached (left-program)
  sessions are immutable history — `SESSION_ALREADY_COMPLETED` and
  `NOT_ENROLLED` respectively.
- **What changes:** only the performed exercise identity of ONE occurrence.
  The authored exercise id, the prescription snapshot (sets/reps or duration),
  and the rest snapshot carry over untouched — they are the occurrence
  contract from the template.
- **What never happens:** no prescription is invented, converted, or
  re-derived for the replacement exercise; no set is ever relabeled. M9
  never infers or converts prescriptions based on the replacement exercise —
  the catalog does not model exercise-specific supported prescription
  schemes, and none are invented here.
- **Why:** the user keeps their equipment/limitation freedom inside a guided
  program while history and progression stay truthful about what was
  actually trained.

The feature deliberately does **not**: filter candidates by the user's
available equipment (the profile is not an input to selection), rank
same-equipment candidates first, read physical-consideration suitability
guidance, make injury/safety claims, invoke AI, or infer prescription
compatibility.

---

## 2. Domain model: authored vs. performed identity

Every exercise log (`ExerciseLog`) carries two exercise identities:

| Field | Meaning | Who writes it |
|---|---|---|
| `authoredExerciseId` | The exercise the workout template prescribed | Template snapshot at session start; never rewritten by substitution |
| `performedExerciseId` | The exercise actually trained | Session start (= authored); rewritten by substitution |

- **Occurrence identity** is `(sessionId, exerciseOrder)` — never the exercise
  id. The same exercise can appear twice in one session as two distinct
  occurrences, and substituting one never touches the other.
- **`isSubstituted` is derived, never persisted:** the domain owns the
  definition via `resolveOccurrenceSubstitutionState(log)` in
  `src/domain/services/session-exercise-substitution.ts`, so persistence and
  presentation never re-derive it.
- **Chained substitutions keep the original authored id:** substituting A → B
  and later B → C leaves `authoredExerciseId = A`; only `performedExerciseId`
  moves. "Originally: A" stays truthful across any chain depth.
- **Restore** returns the occurrence to performed-as-authored identity
  (`performed := authored`).

Implementation: `src/domain/entities/workout-session.ts` (`ExerciseLog`),
`src/domain/services/session-exercise-substitution.ts`.

---

## 3. Substitution & restore semantics (domain service)

`substituteSessionExercise(session, { exerciseOrder, replacementExerciseId })`
swaps only the performed id of the addressed occurrence; everything else
(sets, version token, other occurrences) is untouched.

**Lifecycle invariants (deliberately stronger than "block on completed"):**

1. **Completed sessions are immutable** — `SESSION_ALREADY_COMPLETED`.
2. **An occurrence with ANY logged set can be neither substituted nor
   restored** — `EXERCISE_HAS_LOGGED_SETS`. Relabeling existing sets would
   attach another exercise's loads to the (new) exercise's history and
   progression; the user must explicitly delete the logged sets first —
   nothing is silently discarded or relabeled.
3. **No-op swaps are rejected** — `SUBSTITUTION_NO_CHANGE` when the
   replacement equals the current performed id (substitute) or the occurrence
   is already performed-as-authored (restore).
4. **Unknown occurrence** — `EXERCISE_LOG_NOT_FOUND`.

`restoreSessionExercise` mirrors the same guard chain.

**Eligibility projection (read side of the same rules):**
`resolveOccurrenceSubstitutionEligibility(session, log)` exposes the blocking
rules as `{ isSubstituted, blockedBy, canRestore }` — `blockedBy` is
`'session-completed'`, `'logged-sets'`, or `'skipped'` (M10: substitution
and restore are also blocked while the occurrence is skipped; null when
mutable; the completed-session block outranks logged sets, mirroring the
guards), and `canRestore` is true only for a currently substituted, mutable
occurrence. The session DTOs carry it per log as `substitutionEligibility`
(`workout-session.ts`, `training-history.ts`), so presentation formats it
and never re-derives mutability from raw session facts.

Implementation: `src/domain/services/session-exercise-substitution.ts`.

---

## 4. Candidate selection (tier ranking)

`selectSubstitutionCandidateSet(source, catalog, limit = 8)` in
`src/domain/services/substitution-candidates.ts` ranks catalog exercises as
possible substitutes by **structural similarity only**.

**Tiers — no merging, first non-empty tier wins exclusively:**

1. `same-pattern-same-muscle` — same movementPattern AND same primaryMuscle
2. `same-pattern` — same movementPattern only
3. `same-muscle` — same primaryMuscle only

A source with no structural match yields an **empty candidate list** — a
valid, expected outcome; the selector never falls back to unrelated
exercises.

**Deterministic in-tier ordering (independent of catalog input order):**

1. Greater secondary-muscle overlap with the source first (descending),
2. Same difficulty as the source first,
3. Exercise name ascending,
4. Exercise id ascending — the final total-order tie-breaker, so distinct
   candidates with equal rank keys (e.g. the same display name) never
   depend on the repository's input order.

The catalog input is never mutated; duplicate exercise ids in the input
defensively collapse to their first occurrence. The limit applies only after
filtering, deduplication, and ranking; `isTruncated` is true only when
additional matching candidates existed in the selected tier but were dropped
by the limit (an exactly-at-limit result is NOT truncated).

---

## 5. Application orchestration (use cases)

Two mutation use cases and one read:

- **`SubstituteSessionExerciseUseCase`**
  (`src/application/use-cases/substitute-session-exercise.ts`): validate →
  load session → ownership (`FORBIDDEN`) → enrollment (`NOT_ENROLLED`;
  detached sessions are read-only) → server-side replacement existence
  (`EXERCISE_NOT_FOUND` — a client-supplied unknown id never reaches the
  domain or the write boundary) → domain service → save with optimistic
  concurrency (`SESSION_MODIFIED` on stale version, `NOT_ENROLLED` on
  vanished enrollment).
- **`RestoreSessionExerciseUseCase`**
  (`src/application/use-cases/restore-session-exercise.ts`): same guard
  chain minus the replacement lookup — the authored identity is already in
  the session snapshot.
- **`GetExerciseSubstitutionCandidatesUseCase`**
  (`src/application/use-cases/get-exercise-substitution-candidates.ts`):
  resolves the source from the catalog and delegates ALL candidate selection
  semantics to the pure domain selector. Callers needing candidates for many
  sources in one request (the Active Workout screen) load the catalog once
  and map each source with the exported pure mapper
  `toExerciseSubstitutionCandidatesDto` — one catalog read, never per-card.

The userId always comes from the trusted authenticated session at the
presentation layer, never from client input.

---

## 6. Persistence model

`exercise_logs` (see `src/infrastructure/database/schema/sessions.ts` and
`docs/database.md`):

| Column | Meaning |
|---|---|
| `exercise_id` (NOT NULL) | PERFORMED exercise — the exercise actually trained |
| `authored_exercise_id` (NULLABLE) | AUTHORED exercise — the template prescription; NULL only for pre-M9 legacy rows, where the performed id IS the authored id |

- Primary key `(session_id, exercise_order)` — occurrence identity, not
  exercise identity.
- Both columns carry FKs to `exercises.id` with `ON DELETE RESTRICT`, and
  both have FK indexes.
- Substitution rewrites only `exercise_id`. Migration `0008` added the
  authored column; `session-mapper.ts` maps rows ↔ domain and heals legacy
  NULLs on the next save (see section 11).
- History and progression queries key on `exercise_id` (the PERFORMED
  identity) — never on the authored id.

---

## 7. History & progression truthfulness

**Per-exercise history and progression windows key on the PERFORMED
exercise:**

- A completed substituted occurrence appears in the **performed** exercise's
  history — never under the authored exercise merely because it authored the
  template row. A Goblet Squat authored / Dumbbell Bench Press performed
  occurrence belongs to Dumbbell Bench Press history, exactly once.
- Progression windows (`listRecentCompletedExercisePerformances`) feed the
  performed exercise's window only — the authored exercise's next-target
  recommendation is never influenced by work performed on a substitute.
- Detached (left-program) history stays the user's training past: detached
  substituted occurrences remain under the performed exercise, and
  occurrence identity `(sessionId, exerciseOrder)` survives duplicates —
  each occurrence keeps its own performed identity, never split or
  double-counted.

---

## 8. UI: Active Workout swap panel

`src/features/sessions/session-substitution-views.ts` derives each
occurrence's substitution affordance server-side. Its ONLY business input is
the domain-derived eligibility the session DTO carries
(`substitutionEligibility` from
`resolveOccurrenceSubstitutionEligibility`): the blocked/hidden states map
1:1 from `blockedBy`, and restore availability is `canRestore`. The mapper
never re-derives blocking from logged sets or session status — candidate
presence (replace vs. the honest no-candidates empty state) is its only
visual decision. The panel
(`src/features/sessions/components/SessionExerciseSwapPanel.tsx`)
is a native `<details>` disclosure with native radio cards — arrow-key
navigation and form submission work with zero extra client state:

- **Swap picker:** native radios posting to `substituteExerciseAction` via
  `useActionState`; candidate labels show equipment + difficulty meta; a
  truthful "candidates limited" note renders when truncated.
- **Restore:** a separate native form posting to `restoreExerciseAction`,
  rendered only when the domain's eligibility says restore is currently
  possible (`canRestore`).
- **Expected action errors** surface as user-facing copy via
  `sessionActionErrorLabel`. Whether a failed submit must additionally
  trigger the established `router.refresh()` reload/retry pattern is decided
  centrally by the pure predicate `shouldRefreshAfterSessionMutationError`
  (`src/features/sessions/session-mutation-refresh.ts`), shared by the
  substitute and restore paths: it refreshes on the stale server-state
  outcomes — `SESSION_MODIFIED` (another tab changed the session),
  `SUBSTITUTION_NO_CHANGE` (another tab already applied the same
  swap/restore), `EXERCISE_HAS_LOGGED_SETS`, `SESSION_ALREADY_COMPLETED`,
  `NOT_ENROLLED` (another tab's actions outdated this tab's controls) — so a
  stale tab never keeps an outdated exercise identity, while ordinary
  request/input failures never cause pointless reloads. Only labels of codes
  in that set may promise an automatic reload; every other label (e.g.
  `SESSION_NOT_FOUND`, `EXERCISE_LOG_NOT_FOUND`) points the user at a manual
  reload.
- The **substituted occurrence card shows the performed exercise as primary
  identity** with a subtle "Originally: …" line naming the authored
  exercise — same convention as History (section 9) and as the "Up next"
  upcoming rows (`UpcomingExerciseList.tsx`).

Zod schemas (`session-actions-schema.ts`) guard the action boundary; the
only trusted form fields are the session id, the occurrence order, and the
selected replacement exercise id.

---

## 9. UI: History "Originally: …" context

The completed-session detail screen (`src/features/history/`) renders each
entry with the **PERFORMED exercise as primary identity**; a substituted
occurrence adds one subtle read-only context line under the performed title:

> Dumbbell Bench Press
> Originally: Goblet Squat

Rules (locked in `completed-session-view.ts` /
`CompletedSessionEntryList.tsx`):

- The line renders only when the domain says the occurrence is substituted
  AND the catalog resolves the authored exercise — omitted otherwise,
  **never fabricated**.
- Chained substitutions name the ORIGINAL authored exercise (the authored id
  is never rewritten).
- History is read-only: no substitution controls, no set relabeling.
- Entry identity and order follow the persisted snapshot; duplicate exercises
  never collapse.
- Current catalog names are display-only; an unresolved exercise falls back
  to a positional label ("Exercise 3") instead of hiding the work.

---

## 10. Program progress

Program progress counts **completed sessions per scheduled occurrence** —
`(enrollmentId, scheduledWorkoutId)` via
`listCompletedScheduledWorkoutIds`. It is completely independent of exercise
identity: a completed session whose exercises were substituted marks its
scheduled workout as completed exactly like any other completion, and an
in-progress substituted session never counts. See the integration tests in
`tests/integration/database/workout-session-substitution.test.ts`.

---

## 11. Legacy data (pre-M9 rows)

Rows written before migration `0008` store NULL in
`authored_exercise_id`. Hydration treats NULL as "authored == performed":

- **Reads:** `session-mapper.ts` falls back `authored := performed`, so legacy
  rows hydrate as ordinary performed-as-authored occurrences.
- **Writes:** the first save of a legacy-hydrated session persists an
  explicit authored id (the NULL is healed), and the write path never
  persists NULL again — integration tests lock both behaviors.
- History truthfulness is unaffected: legacy rows were never substituted
  (authored == performed), so they carry no "Originally: …" context.

---

## 12. Testing map

| Behavior | Layer | Test file |
|---|---|---|
| Identity swap semantics, prescription-snapshot invariant, blocked-when-logged lifecycle, eligibility projection (incl. guard agreement) | Domain (unit) | `tests/unit/domain/services/session-exercise-substitution.test.ts` |
| Tier fallback, ranking, id tie-breaker, dedup, limit, truthful truncation | Domain (unit) | `tests/unit/domain/services/substitution-candidates.test.ts` |
| Use-case guard chains (ownership, enrollment, existence, concurrency) | Application (unit) | `tests/unit/application/use-cases/substitute-session-exercise.test.ts`, `restore-session-exercise.test.ts`, `get-exercise-substitution-candidates.test.ts` |
| Row mapping, legacy NULL hydration + heal-on-save, FK enforcement, duplicate occurrence identity | Infrastructure (integration) | `tests/integration/database/workout-session-substitution.test.ts` |
| Completed substituted session still marks its scheduled workout completed; in-progress never counts | Integration | `tests/integration/database/workout-session-substitution.test.ts` |
| Per-exercise history keys on the PERFORMED exercise (substituted occurrence, detached, duplicates) | Integration | `tests/integration/database/training-history-repository.test.ts` |
| Progression window keys on the PERFORMED exercise | Integration | `tests/integration/database/training-history-repository.test.ts` |
| "Originally: …" rendering rules (shown, omitted, positional fallback, chained) | Presentation (unit) | `tests/unit/features/history/completed-session-view.test.ts` |
| Affordance consumes the eligibility projection — never re-derives blocking from raw facts | Presentation (unit) | `tests/unit/features/sessions/session-substitution-views.test.ts`, `tests/unit/features/sessions/active-workout-views.test.ts` |
| "Originally: …" context on substituted upcoming rows ("Up next") | Presentation (unit) | `tests/unit/features/sessions/upcoming-exercise-list.test.ts` |
| Swap panel copy and affordance states | Presentation (unit) | `tests/unit/features/sessions/session-substitution-views.test.ts` |
| Centralized stale-state reload decision — refresh on the stale server-state codes (M10 added `ADJUSTMENT_NO_CHANGE` and `MOVE_OUT_OF_RANGE` to the set), never on ordinary request/input failures | Presentation (unit) | `tests/unit/features/sessions/session-mutation-refresh.test.ts` |
| Swap panel applies the centralized reload decision on both substitute and restore paths; ordinary failures and success never reload | Presentation (unit) | `tests/unit/features/sessions/session-exercise-swap-panel.test.ts` |



