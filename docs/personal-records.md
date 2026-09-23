# Personal Records (M12)

Canonical reference for the Personal Records feature: product scope, locked
semantics, architecture, and explicit deferrals. The Domain layer is the
semantic authority; everything else exists to read exact answers efficiently.

## Product scope

M12 answers two questions, exactly:

1. **Current all-time Personal Bests** for one or more exercises
   (`findCurrentPersonalBests`).
2. **The exact best value strictly before** each supplied record candidate
   (`findBestValuesBefore`), enabling exact historical PR events.

Surfaced today as:

- a **Personal Bests summary** on Exercise History, and
- a **PR badge** on individual set rows inside a completed session.

M12 intentionally does **not**: notify at completion time, mark timeline
points, drive progression, persist derived record state, or rank/compare
across users.

## Metric taxonomy

Exactly three metrics exist. No others may be added casually.

| Metric | Eligible set | Value |
|---|---|---|
| `max-load` | rep set with `weightKg !== null` | `weightKg` |
| `max-bodyweight-reps` | rep set with `weightKg === null` | `reps` |
| `max-duration` | duration set (load ignored) | `durationSeconds` |

`0 kg` is a valid load — `null` means unloaded, `0` means zero. The two rep
metrics are mutually exclusive and exhaustive over rep sets; duration sets
never participate in the load/reps metrics.

## Attribution

Records are always attributed to the **performed ExerciseId**:

- substitution credits the replacement exercise; the authored exercise
  receives nothing;
- a user-added occurrence is fully eligible;
- a substituted user-added occurrence credits the replacement exercise;
- skipped and zero-set occurrences contribute no candidates;
- detached (non-enrolled) completed history counts;
- enrollment state never defines PR history.

`authoredExerciseId`, `occurrenceKey` and `source` are never PR identity.

## Chronology

A performance's `PerformancePosition` is compared lexicographically,
oldest → newest:

1. `completedAt`
2. `startedAt`
3. `sessionId`
4. `exerciseOrder`
5. `setNumber`

A performance is a historical PR iff `value > best eligible value strictly
before its position`:

- the first eligible exposure is a PR;
- strictly greater later values are PRs;
- an equal value is **not** a new PR;
- current PB ownership on equal maxima stays with the **earliest**
  performance.

## Architecture

Layer responsibilities are unchanged by M12:

- **Domain** (`src/domain/services/personal-record-metrics.ts`,
  `personal-records.ts`) — Personal Record semantics and the Domain's own
  record/event types: metric eligibility, position ordering, strict
  comparison, candidate extraction (`extractRecordCandidates`), event
  resolution (`resolveRecordEvents`), authoritative fold
  (`foldPersonalRecords`).
- **Application** (`src/application/ports/personal-record-repository.ts`,
  `use-cases/get-completed-session-record-events.ts`,
  `dto/personal-records.ts`) — owns the read-only repository port and
  use-case orchestration, and maps Domain results to application DTOs
  (`PersonalBestDto`, `SessionRecordEventDto`).
- **Infrastructure** (`drizzle-personal-record-repository.ts`,
  `mappers/personal-record-mapper.ts`) — executes the exact Drizzle/SQL
  projections and maps database/query rows to the Domain records the
  application port expects (`PersonalBest`, `CandidatePriorBest`).
- **Presentation** (`src/features/history/`) — formats values, dates and
  labels, renders the Personal Bests cards and the historical PR badges,
  and never infers record semantics (it never compares values).

### Exercise History current PB flow

```
resolved ExerciseId
  → PersonalRecordRepository.findCurrentPersonalBests
  → PersonalBestDto
  → presentation formatting
  → Personal Bests summary
```

No Domain fold runs in production UI.

### Completed-session historical PR flow

```
completed session
  → extractRecordCandidates
  → findBestValuesBefore
  → resolveRecordEvents
  → SessionRecordEventDto[]
  → merge by (exerciseOrder, setNumber)
  → set-row PR badge
```

No SQL, view or component decides strictness. `(exerciseOrder, setNumber)`
is the stable historical location of a logged set, so badges attach to the
exact set that produced the record; occurrence-level badges are never
inferred.

## Exactness

- No top-K candidate bound, no page-size dependency, no bounded window:
  every eligible prior performance can influence the answer.
- `findBestValuesBefore` answers in one batched round trip per request; the
  maximum eligible prior value is chosen in SQL by the same position ladder
  the Domain uses.
- Current PBs are ranked in SQL per `(exerciseId, metric)` by
  `value DESC, completedAt ASC, startedAt ASC, sessionId ASC,
  exerciseOrder ASC, setNumber ASC`, selecting rank 1 — maximum value and
  earliest equal owner, computed in the database, not in memory.
- Integration tests cross-check the optimized SQL against the Domain
  `foldPersonalRecords` oracle: one semantic implementation (Domain)
  verified against one projection (SQL).

## Persistence

- Derived read model only: eligible rows already stored in sessions,
  exercise logs and set logs are projected at read time.
- **No PR table, no persisted PR state, no derived writes.**
- **No migration was added in M12.**

## Performance

- Both repository methods are user-scoped, completed-only and batched:
  multi-exercise PB lookup in one query; all candidates for a request in one
  query (parameterized candidate relation) — no N+1.
- Best-before uses a correlated `MAX` per candidate. Measured ≈117 ms vs
  ≈997 ms for the joined/grouped alternative on a ~297k-set dataset — the
  correlated shape is kept deliberately.
- Reuses existing session/log/set indexes; no new index, no migration.

## M8–M11 interactions

- **M8 progression:** Personal Records are read-only advisory history and
  never feed progression decisions, recommendation inputs or display.
- **M9 substitution / M10 reorder+skip / M11 add-remove:** unchanged. M12
  only reads their persisted results and follows the performed ExerciseId
  and the final persisted positions.

## UI scope

- Exercise History: Personal Bests summary — only returned metrics render
  (no fake empty cards), 0 kg renders, the owning session link comes from
  the repository winner, and a later equal value does not steal ownership.
- Completed session: compact accessible `PR` badge on exactly the matching
  set row — a first exposure can badge, an equal later set cannot, and an
  old PR stays badged after later records.
- Nothing is hover-only; no confetti, trophies or motivational copy.

## Explicitly deferred

- completion-moment New PR banner/toast
- exercise-history PR timeline markers
- dashboard PR widgets
- completed-session-list indicators
- volume, e1RM, and RPE records
- streaks/gamification
- any progression influence
