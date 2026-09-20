# Session Adjustments: Skip & Adjacent Reorder (M10)

M10 adds two session-scoped, owner-only, in-progress-only adjustments to a
workout session's exercise occurrences: **skip/unskip** and **adjacent move
up/down**. This document is the canonical reference for both features —
domain semantics, persistence, application orchestration, UI affordances,
history truthfulness, and testing. Substitution (M9) is a sibling feature
covered separately in
[`docs/exercise-substitution.md`](exercise-substitution.md).

Everything below describes shipped behavior — the code is the final
authority, and each section points to its implementation.

---

## Contents

1. [Overview & product intent](#1-overview--product-intent)
2. [Occurrence identity](#2-occurrence-identity)
3. [Skip semantics (domain)](#3-skip-semantics-domain)
4. [Substitution interaction](#4-substitution-interaction)
5. [Adjacent reorder semantics (domain)](#5-adjacent-reorder-semantics-domain)
6. [Application orchestration (use cases)](#6-application-orchestration-use-cases)
7. [Persistence model](#7-persistence-model)
8. [Progress: denominator & completion](#8-progress-denominator--completion)
9. [History & progression truthfulness](#9-history--progression-truthfulness)
10. [Program progress](#10-program-progress)
11. [UI: Active Workout affordances](#11-ui-active-workout-affordances)
12. [UI: Completed-history truthfulness](#12-ui-completed-history-truthfulness)
13. [Concurrency](#13-concurrency)
14. [Deferred to M11](#14-deferred-to-m11)
15. [Testing map](#15-testing-map)

---

## 1. Overview & product intent

- **Who can adjust:** the session owner, on an **in-progress** session they
  are still enrolled in. Completed and detached (left-program) sessions are
  immutable history.
- **Skip** records the explicit user decision *not to perform* one occurrence
  in this session — the occurrence stays in the session aggregate with its
  identity, prescription and rest intact, but contributes no work.
- **Adjacent move up/down** repositions one occurrence relative to its
  neighbor — the whole occurrence (identity, prescription, skip decision,
  logged sets) travels as one unit.
- **Why:** adults 40+ legitimately need to drop an exercise on a given day
  (pain, time, equipment) and re-order the flow of the workout without the
  program template ever being rewritten. History stays truthful about what
  was and wasn't done.

M10 deliberately does **not**: add optional exercises, remove authored
exercises, support drag/drop or arbitrary permutation, persist occurrence
provenance, or alter completion/program-progress semantics (see
[§14](#14-deferred-to-m11)).

---

## 2. Occurrence identity

- **Occurrence identity — the business locator used by every command —
  remains `(sessionId, exerciseOrder)`.** There is no surrogate identity:
  the same exercise can appear twice in one session as two distinct
  occurrences, and adjusting one never touches the other. (The PR #13
  corrective pass added a **presentation-stability token**, `occurrenceKey`,
  alongside this identity — see below. It is an *attribute of* the
  occurrence, never an address for it.)
- **`exerciseOrder` is mutable while the session is in progress.** Moves are
  the only mutation path; after every successful move the array is
  **canonical**: `exerciseLogs[index].order === index + 1` with orders dense
  `1..N`.
- **`occurrenceKey` — the stable render token (PR #13 Finding 1).** Because
  `exerciseOrder` is mutable, it cannot also be React's identity: two
  *completely identical duplicate* occurrences (same authored id, same
  performed id, same prescription) are indistinguishable in every other
  persisted field, so any order-derived key hands one duplicate's local UI
  state to the other when they swap. `ExerciseLog.occurrenceKey`
  (migration `0010`) is an immutable, session-unique integer assigned at
  creation (defaulting to the initial order). It travels with the occurrence
  through reorder, skip/unskip, substitution/restore and set mutations; it
  is **never** an input to any use case, Server Action or Zod schema, never
  a repository query predicate, and never part of history/progression
  identity. Uniqueness within a session is domain-enforced at construction
  (deliberately no DB constraint — see
  [§7](#7-persistence-model)). The view mapper derives
  `renderKey: 'occ:${occurrenceKey}'` from it alone, including the inner
  `SetLoggerForm` remount keys. The Active Workout screen renders every
  occurrence under ONE keyed `SessionOccurrence` boundary in a single
  canonical-order list, keyed by `renderKey` (see
  [§11](#11-ui-active-workout-controls)) — so the token is not just stable
  within a band, it survives the occurrence crossing between the full-card and
  compact representations.
- **Completed sessions freeze the final occurrence order.** No adjustment
  use case accepts a completed session (`SESSION_ALREADY_COMPLETED`).
- The repository's whole-aggregate rewrite makes adjacent reordering safe:
  children (exercise logs and their sets) are deleted and reinserted
  transactionally, so no transient `(session_id, exercise_order)` key
  collision can occur mid-swap and sets can never be orphaned between
  movers.


---

## 3. Skip semantics (domain)

`exercise_logs.is_skipped` (DTO: `ExerciseLog.isSkipped`) is **explicit
persisted state**. Skip is **never inferred from zero logged sets** — a
zero-set non-skipped occurrence is a distinct, valid state (see
[§8](#8-progress-denominator--completion) and
[§12](#12-ui-completed-history-truthfulness)).

Rules, enforced by `src/domain/services/session-exercise-adjustment.ts` and
`src/domain/entities/workout-session.ts`:

- Skip is allowed only while the session is in progress
  (`SESSION_ALREADY_COMPLETED` otherwise).
- Skip is **blocked when the occurrence already has logged sets**
  (`EXERCISE_HAS_LOGGED_SETS`) — the user must delete those sets first;
  nothing is silently discarded.
- Unskip is allowed while the session is in progress on a currently skipped
  occurrence (`ADJUSTMENT_NO_CHANGE` for a no-op unskip).
- **Logging a set on a skipped occurrence is blocked**
  (`EXERCISE_OCCURRENCE_SKIPPED`) — the skip⇔logged-sets exclusion is
  mutual. The domain is the only enforcement boundary for this cross-table
  rule; there is deliberately no database CHECK for it.
- A skipped occurrence **remains part of the session aggregate**: authored and
  performed exercise ids, prescription snapshot, rest snapshot, and order
  remain intact.
- A skipped occurrence contributes **nothing** to the prescribed-set progress
  denominator (see [§8](#8-progress-denominator--completion)).
- A skipped occurrence contributes **no performance history and no
  progression input** (see [§9](#9-history--progression-truthfulness)).
- Session completion still requires **at least one logged set somewhere** —
  a skip-only session cannot complete.

---

## 4. Substitution interaction

Substitution (M9) and skip (M10) are **independent states**. A substituted
occurrence may later be skipped — substitution is blocked only *while*
skipped, so the legitimate sequence substitute → skip leaves:

```
authoredExerciseId !== performedExerciseId  (still true)
isSkipped = true                            (now also true)
```

While skipped, substitution and restore actions are blocked (blockedBy
`'skipped'` in the substitution eligibility projection — the `blockedBy`
union grew from `'session-completed' | 'logged-sets'` to include
`'skipped'`). **Unskipping preserves the existing substitution** — only the
skip decision changes.

Completed history must show this truthfully without implying performance: the
performed exercise stays the primary identity, the "Originally: …" line
names the authored exercise, and the neutral Skipped badge replaces set
output (see [§12](#12-ui-completed-history-truthfulness)).

Full substitution semantics:
[`docs/exercise-substitution.md`](exercise-substitution.md).

---

## 5. Adjacent reorder semantics (domain)

Only **adjacent** moves are supported — `moveSessionExercise(session,
{ exerciseOrder, direction: 'up' | 'down' })` in
`src/domain/services/session-exercise-adjustment.ts`:

- **Move Up:** swap the addressed occurrence with the one above.
- **Move Down:** swap with the one below.
- No drag/drop. No arbitrary permutation API. A move at a boundary
  (`MOVE_OUT_OF_RANGE`) is rejected — the first occurrence can't move up,
  the last can't move down.

Reordering is allowed regardless of the occurrence's state — it is allowed
when the occurrence **has logged sets**, when it is **skipped**, and when it
is **substituted**. Occurrence state never blocks a reorder, because the
whole occurrence moves as one unit:

- `authoredExerciseId` / `performedExerciseId`
- the prescription snapshot
- `restSeconds`
- `isSkipped`
- the logged sets

After every successful move, the returned session is canonical:
`exerciseLogs[index].order === index + 1`, orders dense `1..N`. Duplicate
exercise ids remain distinct occurrences — swapping one `ex-001` occurrence
never touches the other's sets (identity is `(sessionId, exerciseOrder)`,
never the exercise id).

---

## 6. Application orchestration (use cases)

Three use cases in `src/application/use-cases/`, each following the M9
guard-chain pattern (no direct repository access by the UI, ownership and
enrollment verified server-side):

- **`SkipSessionExerciseUseCase`** (`skip-session-exercise.ts`)
- **`UnskipSessionExerciseUseCase`** (`unskip-session-exercise.ts`)
- **`MoveSessionExerciseUseCase`** (`move-session-exercise.ts`)

Shared guard chain: ownership/`SESSION_NOT_FOUND` → enrollment
(`NOT_ENROLLED` on vanished enrollment) → input validation (`INVALID_INPUT`)
→ domain service → save with optimistic concurrency (`SESSION_MODIFIED` on
stale version). Domain failures surface with their own codes
(`SESSION_ALREADY_COMPLETED`, `EXERCISE_LOG_NOT_FOUND`,
`EXERCISE_HAS_LOGGED_SETS`, `ADJUSTMENT_NO_CHANGE`, `MOVE_OUT_OF_RANGE`).
On success each builds its DTO from the **persisted aggregate returned by
`save()`** — so the returned `version` is the committed database version,
never the pre-save snapshot's. A caller chaining a second occurrence
mutation from the first result therefore sends a current
`expectedSessionVersion` (PR #13 Finding 5). Server actions currently
discard the DTO and revalidate the session route.

Server actions (`src/features/sessions/actions/`) are thin Zod-validated
boundaries delegating to these use cases; expected errors return as typed
`SessionActionState` data, never thrown.

---

## 7. Persistence model

M10's schema changes are migrations `0009_elite_hellion` and `0010_loud_lady_bullseye`:

```sql
-- 0009
ALTER TABLE "exercise_logs" ADD COLUMN "is_skipped" boolean DEFAULT false NOT NULL;
-- 0010 (PR #13 Finding 1)
ALTER TABLE "exercise_logs" ADD COLUMN "occurrence_key" integer;
```

- **`is_skipped`** — `NOT NULL DEFAULT false`: rows written before M10
  hydrate as not skipped; skip is a stored fact, never inferred.
- **`occurrence_key`** (PR #13 Finding 1) — nullable integer, **no default,
  no CHECK, no trigger**, and never backfilled. Assigned at session creation
  and immutable thereafter, it is
  the per-occurrence presentation-stability token (see
  [§2](#2-occurrence-identity)) — **not** an identity: the composite PK
  stays `(session_id, exercise_order)`, `set_logs`' composite FK stays on
  that pair, and no query, action schema or history projection ever
  references the column. Uniqueness within a session is enforced by the
  domain at construction AND at the database level: the partial unique index
  `exercise_logs_session_occurrence_key_unique` (migration `0011`) covers
  `(session_id, occurrence_key) WHERE occurrence_key IS NOT NULL` (PR #13
  corrective pass). The repository maps that index's violations BY NAME to
  the typed `SessionOccurrenceKeyConflictError` — never to the catch-all
  `SessionAlreadyExistsError`, which stays reserved for the
  one-session-per-(enrollment, occurrence) constraint on `workout_sessions`.
  Rows written before the column existed hydrate with
  `occurrenceKey ?? exerciseOrder` (the pre-M10-fix key source, so the
  transition causes no remount); the next whole-aggregate save persists the
  coalesced token, healing the NULL. Completed sessions never save again and
  keep NULL harmlessly. Session creation defaults each
  `occurrenceKey` to the occurrence's initial order; the in-memory
  repository (unit-test world) mirrors all of these semantics by storing
  the aggregate as-is.
- Skips and moves both save through the existing whole-aggregate repository
  write path (delete children → reinsert, version check), so skip
  round-trips, reorder persistence and `occurrence_key` round-trips need no
  dedicated SQL. The Drizzle mapper sorts hydrated rows by `exerciseOrder`
  at the read boundary (row ordering at the repository boundary, not a
  presentation concern).
- **`save()` returns the persisted aggregate** carrying the committed
  database `version` (PR #13 Finding 5) — read from `.returning()`, not
  recomputed in application code; both implementations (Drizzle, in-memory)
  honor it, and every save-then-return-DTO use case builds its DTO from it.

---

## 8. Progress: denominator & completion

**Prescribed-progress denominator.** The domain owns the skip-aware totals:
`resolveSessionPrescriptionTotals(session)` returns
`{ prescribedSets, skippedOccurrences }` — `prescribedSets` sums
`prescription.sets` across **non-skipped** occurrences only. The DTO
projects both numbers (`WorkoutSessionDto.prescribedSets`,
`.skippedExerciseCount`); presentation renders them and **never recomputes
skip-adjusted denominators locally**.

**Completion rule (unchanged, F6).** A session is completable when at least
one set is logged somewhere in it — `resolveSessionCompletionReadiness`
(lives on the entity, `workout-session.ts`, next to `completeWorkoutSession`)
/ `completeWorkoutSession` delegate to this definition. M10 adds **no**
"every non-skipped occurrence must be performed" requirement — skips never
block completion.

---

## 9. History & progression truthfulness

- Per-exercise history and progression queries key on **actual logged work**:
  they join on `set_logs` existence, so a zero-set skipped occurrence is
  naturally excluded — for both the performed and the authored identity. No
  query changes were made for M10; the persisted flag is authoritative only
  in the completed-session detail view.
- The M8 progression input read (`listRecentCompletedExercisePerformances`)
  never sees skipped occurrences — the next recommendation cannot anchor to
  zero work.
- Reorder does not alter performance identity: history entries key on
  `(sessionId, exerciseOrder)`, so after a move the occurrence's historical
  entries appear under their **new** order with their own sets attached —
  sets are never relabeled across movers.

---

## 10. Program progress

Program progress remains **workout/session-completion based**
(`listCompletedScheduledWorkoutIds`: completed `(enrollmentId,
scheduledWorkoutId)` pairs). Skip and reorder do not alter it:

- A completed session containing skips still counts toward program progress
  exactly like any other completion.
- Reordering before completion has no effect — session identity, not its
  exercise mix or order, is what progress consumes.
- Detached (left-program) sessions never count.


---

## 11. UI: Active Workout affordances

Eligibility is never re-derived in components; the pure view mapper
`session-adjustment-views.ts` maps the domain's `adjustmentEligibility`
DTO projection verbatim into a `SessionAdjustmentView`:

- **`open`** — skip control ("Skip exercise") posts to `skipExerciseAction`.
- **`skipped`** — undo control ("Undo skip") posts to `unskipExerciseAction`;
  the card shows a neutral `Skipped` badge and truthful hint ("Skipped in
  this session — it logged no sets and adds none to your progress.").
- **`blocked-logged-sets`** — no skip control; truthful muted copy ("Delete
  your logged sets to skip this exercise."). **The move controls still
  render**: logged sets freeze only the skip decision, never a reorder.
- **`hidden`** — completed/read-only session: no mutation controls at all
  (not even Undo skip — the decision is frozen at completion).

Adjacent-move controls ("Move up"/"Move down") render per the domain's
`canMoveUp`/`canMoveDown` (adjacency + in-progress facts), consumed verbatim
from the view mapper — never re-derived from array position, skip state, or
set counts. A **skipped occurrence still moves** (only the skip decision is
tied to it).

**Canonical rendering order (PR #13 Finding 4).** The Active Workout screen
does not partition by state and concatenate; the pure view mapper's
`splitSessionExerciseCardBands` splits the canonical DTO-ordered card list
once — **after the last non-`upcoming` card** — into `cards` (canonical
prefix) and `upcoming` (canonical suffix, all untouched). Concatenated, the
bands are element-for-element the input, so DOM order **is** canonical DTO
order: a touched or skipped occurrence interleaved between untouched ones
(e.g. `1 active, 2 upcoming, 3 skipped`) renders visually as 1 / 2 / 3
instead of 1 / 3 / 2. Skipped cards stay visibly skipped in the full-card
band (badge + hint); untouched occurrences keep their compact "Up next"
rows; no presentation sorting exists anywhere. The move controls therefore
always sit visually beside the occurrence's real adjacent neighbor.

**One keyed occurrence boundary (PR #13 P2).** The screen renders all
occurrences through a SINGLE `SessionOccurrence` client boundary — keyed
`card.renderKey` (i.e. `occ:${occurrenceKey}`) — in one canonical-order list,
choosing either the full `SessionExerciseCard` or the compact
`UpcomingExerciseRow` per entry. React only matches keys among a parent's
children, so the previous two-band markup (full cards in one `<div>`, rows
inside `UpcomingExerciseList`'s `<section><ol>`) unmounted/remounted an
occurrence whenever a reorder moved it between the bands, losing its logger
draft and open disclosure. The boundary now OWNS that occurrence-local state
(controlled `SetLoggerForm` draft + controlled disclosure) and is never
reparented, so the draft and disclosure follow the occurrence as its
representation changes. The "Up next" grouping is presentation only: the
boundary no longer owns the rows. No global store, no new persistence, no
order-based keys, and the canonical DTO order is unchanged (concatenated bands
still equal the input).

Mechanics (`SessionExerciseAdjustPanel.tsx`): the client boundary composes
two presentational islands — `SessionSkipControl` (skip/undo-skip form) and
`SessionMoveControls` (the two adjacent-move forms, each carrying its own
hidden `direction` input) — with **two `useActionState` hooks kept in the
panel** (the skip path and the move path post to different actions) and a
**combined pending flag** so a second click can never submit a duplicate,
the wrong form, or the wrong direction. The hooks must stay in the panel:
moving one into an island would silently drop the combined-pending
guarantee. Submissions share the `createSessionMutationSubmit` factory
(`session-mutation-submit.ts`): it applies the route fields, invokes the
single Server Action, and refreshes only on the centralized stale codes.
There is **no client-side optimistic reorder**: after a successful move the
server revalidates the session route and the canonical DTO order renders as
received. Error labels and the shared refresh semantics live in
`session-action-labels.ts` / `session-mutation-refresh.ts`.

---

## 12. UI: Completed-history truthfulness

The completed-session detail view (`completed-session-view.ts` +
`CompletedSessionEntryList.tsx`):

- **Shows skipped occurrences** — a skipped occurrence is not hidden; it
  renders a de-emphasized card (`opacity-80`) with a neutral `Skipped` badge
  replacing set output: no set rows, no "No sets were logged." line, no
  fabricated metrics.
- **Uses the final persisted session order** — the DTO's canonical
  `exerciseOrder` order, never reconstructed from the template.
- **Skipped occurrences do not link to exercise performance history**
  (`historyHref` is null whenever `isSkipped` — the flag is authoritative,
  never inferred from zero sets; a valid slug alone doesn't earn a link).
- **Substituted+skipped occurrences preserve truthful identity** — the
  performed exercise stays the primary title, the "Originally: …" line
  names the authored exercise, and no performance is implied.
- **No mutation controls in History** — not even Undo skip.
- A **zero-set non-skipped** occurrence is distinct: it keeps "No sets were
  logged." + the exercise link (when the slug resolves) and is **never**
  labeled skipped.

---

## 13. Concurrency

All M10 mutations ride the existing optimistic-concurrency model, plus a
stale-rendered-intent guard (PR #13):

- Every save bumps the row `version`; a save whose version no longer
  matches the persisted row throws `SessionStaleVersionError`, which the
  use cases map to `SESSION_MODIFIED`.
- **Stale rendered intent:** `exerciseOrder` is mutable, so a tab rendered
  before a concurrent reorder holds an order that now identifies a
  DIFFERENT occurrence — and the use case's reload+save would commit with a
  fresh version, invisible to repository optimistic concurrency. Every
  occurrence-addressed command therefore carries `expectedSessionVersion`
  (the rendered snapshot's `version`, exposed on `WorkoutSessionDto` and
  submitted by every mutation form), and the use case compares it against
  the loaded aggregate BEFORE interpreting `exerciseOrder` — mismatch
  maps to the existing `SESSION_MODIFIED`, leaving the current occupant
  untouched. The shared guard lives in
  `src/application/use-cases/session-version-guard.ts`; the in-memory
  repository mirrors the Drizzle version semantics (bump on update, reject
  stale) so use-case tests observe the same outcomes as PostgreSQL.
- **Adjacent reorder with logged sets is safe** because the aggregate is
  saved atomically (delete + reinsert inside one transaction with the
  version check): a stale write cannot silently relabel exercise/set
  identity — it is rejected wholesale. Integration tests lock both the
  stale-move rejection and the set-attachment after a legitimate move.
- **Committed version is returned, never pre-save:** `save()` returns the
  persisted aggregate, and every save-then-return-DTO use case builds its
  DTO from it (see [§6](#6-application-orchestration-use-cases)). A caller
  that chains a second mutation from a first result's `version` therefore
  sends a current `expectedSessionVersion` — the version consumed by the
  stale-rendered-intent guard above stays trustworthy end to end.
- **React state never follows the mutable order keys:** occurrence
  subtrees render under the view mapper's `renderKey`
  (`occ:${occurrenceKey}`), derived from the persisted, immutable
  `occurrenceKey` token ([§2](#2-occurrence-identity)) — including the
  inner `SetLoggerForm` remount keys. Because the token is stable across
  reorder, skip, substitution and set mutations, an occurrence keeps its
  own local state (logger drafts, open editors, open disclosures) through
  every adjustment, and two completely identical duplicate occurrences
  never exchange state — a reorder that seats a different occurrence at an
  order remounts that subtree instead of handing it the previous
  occupant's state. Same occurrence, same key — ordinary rerenders keep
  their state. Crucially, the key is matched among the children of ONE parent:
  every occurrence renders under a single `SessionOccurrence` boundary in
  canonical DTO order ([§11](#11-ui-active-workout-controls)), so a reorder
  that moves an occurrence between the full-card and compact "Up next"
  representations does not reparent the subtree — the boundary owns the logger
  draft and disclosure state and carries them across the representation change.
  The draft is controlled by that boundary (optional on `SetLoggerForm`), and
  it resets only when the resolved logger IDENTITY changes (a logged set or a
  new prefill) — never on a reorder, skip, substitution or band crossing. A
  skip makes the logger vanish, but that absence is NOT a new logger identity:
  the boundary remembers the last non-null logger identity (PR #13 corrective
  pass, Finding 3) and restores the exact draft on unskip. Only a genuinely
  different identity — different prefill/set count — resets the fields.
  The disclosure is likewise owned by the boundary, with ONE explicit
  transition rule (PR #13 P2 follow-up): a change INTO `done` retracts it, so
  an occurrence that logs its final prescribed set stops keeping the expanded
  logger it inherited from its active past (which would otherwise accumulate
  open logging forms behind the next active occurrence). Because the rule
  fires only on a `kind` transition, a pure reorder or an ordinary rerender
  never closes an open disclosure — it still follows the occurrence across
  slots and bands.
- The UI reacts centrally via `shouldRefreshAfterSessionMutationError`
  (`session-mutation-refresh.ts`), which treats exactly the stale
  server-state outcomes as reload-worthy — see the module's code docs.

---

## 14. Deferred to M11

M10 does **NOT** support:

- **Add optional exercise** (session-added occurrences) — deferred to M11.
- **Remove user-added exercise** — arrives, if at all, with session-added
  occurrences.
- **Arbitrary reorder** (jump to any position) — only adjacent moves exist.
- **Drag/drop** reorder UI.
- **Persisted occurrence source/provenance** — M10 occurrences are all
  template-authored; there is no `source` column or provenance semantics.

M11 may introduce session-added occurrences and the required
provenance/prescription semantics for them. Nothing in M10 pre-implements
M11.


---

## 15. Testing map

| Behavior | Layer | Test file |
|---|---|---|
| Skip/unskip lifecycle, logged-sets block, skip⇔sets exclusion, eligibility projection, prescription totals | Domain (unit) | `tests/unit/domain/services/occurrence-adjustment-rules.test.ts`, `session-exercise-skip.test.ts`, `session-prescription-totals.test.ts` |
| `EXERCISE_OCCURRENCE_SKIPPED` on set-logging; skipped occurrences survive moves; canonical defaults in `buildWorkoutSession` | Domain (unit) | `tests/unit/domain/entities/workout-session.test.ts` |
| Adjacent moves (first/middle/last), boundary failures, dense canonical orders, whole-unit move (sets/skip/substitution travel together), duplicate-id distinctness | Domain (unit) | `tests/unit/domain/services/session-exercise-reorder.test.ts` |
| `occurrenceKey` factory default (= initial order), explicit assignment, duplicate-key rejection, stability through set mutations | Domain (unit) | `tests/unit/domain/entities/workout-session.test.ts` |
| Duplicate identical occurrences reorder with distinct `occurrenceKey`s travelling per occurrence | Domain (unit) | `tests/unit/domain/services/session-exercise-reorder.test.ts` |
| Skip/unskip/move guard chains (ownership, enrollment, concurrency mapping, no-change); every save-then-return-DTO use case returns the **committed** version; chained second mutation with the returned version succeeds | Application (unit) | `tests/unit/application/use-cases/skip-session-exercise.test.ts`, `unskip-session-exercise.test.ts`, `move-session-exercise.test.ts`, `session-stale-rendered-intent.test.ts` |
| Logging onto a skipped occurrence blocked at the use case | Application (unit) | `tests/unit/application/use-cases/log-session-set.test.ts` |
| `isSkipped`/`occurrenceKey` DTO projection + skip-adjusted totals | Application (unit) | `tests/unit/application/dto/workout-session.test.ts` |
| Skip persistence round-trip (false→true→false whole-aggregate), column-default hydration | Integration | `tests/integration/database/workout-session-skip.test.ts` |
| Real-PostgreSQL reorder persistence, set_logs attachment to the correct occurrence, stale-version rejection (no silent relabel), `save()` returns the committed version; `occurrence_key` round-trip, legacy NULL hydration + self-heal, session-unique keys after reorder; partial unique index rejects duplicate keys in-session (typed `SessionOccurrenceKeyConflictError`), allows keys across sessions and any number of legacy NULLs | Integration | `tests/integration/database/workout-session-reorder.test.ts` |
| Skipped zero-set excluded from history/progression for both identities; reordered history keys on new order; completed-with-skips counts toward program progress; detached never counts | Integration | `tests/integration/database/training-history-repository.test.ts` |
| Skip/unskip/move action schemas; no action schema exposes `occurrenceKey` | Presentation (unit) | `tests/unit/features/sessions/session-actions-schema.test.ts` |
| Skip/unskip/move actions delegate to use cases with trusted identity | Presentation (unit) | `tests/unit/features/sessions/skip-actions.test.ts`, `move-actions.test.ts`, `session-mutation-actions.test.ts` |
| Eligibility consumed verbatim from the DTO projection (never re-derived); blocked skip still moves; hidden states | Presentation (unit) | `tests/unit/features/sessions/session-adjustment-views.test.ts`, `session-exercise-adjust-panel.test.ts`, `session-exercise-card.test.ts` |
| No client optimistic reorder; **canonical DTO order rendered as-is** (`1 active / 2 upcoming / 3 skipped` → DOM 1/2/3); pending prevents duplicate submits | Presentation (unit) | `tests/unit/features/sessions/active-workout-views.test.ts`, `active-workout-screen.test.ts`, `session-exercise-adjust-panel.test.ts` |
| `renderKey` derives from `occurrenceKey` only — distinct for duplicate identical occurrences, unchanged by reorder/substitution | Presentation (unit) | `tests/unit/features/sessions/active-workout-views.test.ts` |
| React draft state follows the occurrence, not the order slot (identical-duplicate reorder keeps each draft with its occurrence) | Presentation (unit) | `tests/unit/features/sessions/upcoming-exercise-list.test.ts` |
| A draft + open disclosure survive an occurrence crossing between the full-card and compact "Up next" render bands (one keyed `SessionOccurrence` boundary), and never leak to the neighbor | Presentation (unit) | `tests/unit/features/sessions/session-occurrence-band-crossing.test.ts` |
| A draft survives skip → rerender → unskip (logger absence is not a new logger identity); a genuinely changed logger identity still resets | Presentation (unit) | `tests/unit/features/sessions/session-occurrence-band-crossing.test.ts` |
| A completed occurrence (`active` → `done`) retracts its logger disclosure while the next active occurrence stays loggable; a `kind`-unchanged ordinary rerender toggles nothing | Presentation (unit) | `tests/unit/features/sessions/session-occurrence-band-crossing.test.ts` |
| Centralized refresh decision (stale codes refresh, ordinary failures never reload); shared submit factory (route fields, single action call, verbatim result) | Presentation (unit) | `tests/unit/features/sessions/session-mutation-refresh.test.ts`, `session-mutation-submit.test.ts` |
| History truth: skipped visible, no performance link, substituted+skipped truthful, final reordered order, zero-set≠skipped | Presentation (unit) | `tests/unit/features/history/completed-session-view.test.ts`, `completed-session-entry-list.test.ts` |

---

Implementation entry points: `src/domain/services/occurrence-adjustment-rules.ts`,
`session-exercise-skip.ts`, `session-exercise-reorder.ts`,
`session-prescription-totals.ts` (domain rules),
`src/application/use-cases/{skip,unskip,move}-session-exercise.ts`
(orchestration), `src/features/sessions/` (actions + UI), and
`src/features/history/` (completed-session truth).

