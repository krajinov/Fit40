# Plan Follow-Through (M16)

Canonical reference for the M16 milestone: how the current run's calendar
intent is reconciled with session truth, the eight Domain outcomes and their
precedence, the eight-week UTC week model, why M16 evaluates the CURRENT
calendar rather than a historical plan, how it differs from M14 completion and
M13 weekly insights, what it reads (and never writes), and what it deliberately
does not do. Domain is the semantic authority for outcomes, weeks and counts;
Application orchestrates with a caller-supplied clock; Presentation formats
DTO truth and never recomputes any of it.

## Purpose & scope

Plan Follow-Through answers one question:

> How has the current program run followed its current training calendar?

It reconciles the run's existing truths, adding no new authority or judgement:

1. **authored program structure** (`scheduled_workouts`) — the run's
   occurrences, addressed as opaque ids by this read;
2. **current calendar intent** (`planned_workouts`) — the dates the run is
   currently scheduled on (M15);
3. **execution facts** (`workout_sessions`) — what actually started and
   completed;
4. **recorded settlement** (`not_performed_workouts`, M17) — an explicit user
   attestation, never a date inference; it adds counts, never a verdict.

The read is **read-only**. Nothing in M16 writes, mutates, completes or moves
anything, and no completion, progression, personal-record, history or planning
authority changes.

It is **not a historical plan audit**: it describes the calendar as it stands,
never the plan as it once was (see [Current-calendar limitation](#current-calendar-limitation)).

## Run scope

Follow-through is scoped to **one enrollment/run**:

- ownership is resolved server-side from the trusted `userId` plus the program
  pair; the caller never supplies an `EnrollmentId`;
- a **restart or rejoin creates a new `EnrollmentId`**, so the new run starts
  with a fresh, empty report — truthfully, because it has a fresh calendar;
- **detached historical sessions** (a leave nulls `enrollment_id`, keeping the
  sessions as user history) can never contribute to a run's report: they are
  excluded by enrollment identity at the query, not filtered away later;
- another enrollment or another user's run cannot contribute either.

**History and follow-through are different views.** Detached and superseded
sessions remain valid training history — M16 never deletes, hides or rewrites
them; it simply does not report them as *this run's* calendar follow-through.

## Outcomes

Eight Domain outcomes, resolved by `resolveFollowThroughOutcome`
(`src/domain/services/plan-follow-through.ts`), in locked precedence:

1. **completed** — a completion fact, refined by comparing the **UTC calendar
   day** of `completedAt` with the zoneless `PlannedDate`:
   `completed-early` (day before), `completed-on-plan` (same day),
   `completed-late` (day after);
2. **started** — a live in-progress session and no completion;
3. **not-performed** — a recorded `NotPerformedOccurrence` (M17) and neither
   fact above; an explicit user attestation, never derived from a date;
4. **date-derived** — otherwise the planned date against today:
   `past-due`, `today`, `upcoming`.

Precedence in one line: **completed fact > in-progress fact > recorded fact >
planned-date classification**. Consequences: a completed occurrence is never
`started`, `not-performed`, `past-due`, `today` or `upcoming`; an in-progress
occurrence is never `past-due`; only occurrences with none of the three facts
are classified from dates.

`completed-early` / `completed-late` are **classifications, not judgements**.
There is no grace period, no time-of-day comparison and no local-time
interpretation: a workout completed one UTC calendar day after its planned date
is `completed-late`. A failed read or a contract violation throws (corrupt data
is loud); expected absence is returned as data.

Parity with M15 is pinned by a guard test: the three completed variants
normalize back to M15's single `completed`, `started` to `in-progress`,
`not-performed` to M15's `not-performed`, and `today`/`upcoming` to `planned`,
so the two taxonomies cannot silently drift.

## Weekly summary

Weeks are the existing **Fit40 training week**: UTC Monday 00:00:00 inclusive
to the next Monday exclusive (`listRecentTrainingWeekWindows` — the same model
M13 insights and M15's calendar use). One report covers the **most recent 8
weeks, ending with the current week** (`FOLLOW_THROUGH_WEEK_COUNT = 8`,
deliberately equal to M13's horizon).

Per week, and summed as section totals, seven integers are reported:

| Count | Meaning |
|-------|---------|
| `planned` | planned occurrences dated inside the week |
| `completed` | occurrences completed, whichever side of their planned date |
| `completedEarly` | completions whose UTC day precedes the planned date |
| `completedLate` | completions whose UTC day follows the planned date |
| `started` | occurrences with a live session and no completion |
| `pastDue` | occurrences with no session whose planned date has passed |
| `notPerformed` | occurrences recorded as not performed (M17) |

How completions distribute:

- **on plan** contributes to `completed` **only**;
- **early** contributes to `completed` **and** `completedEarly`;
- **late** contributes to `completed` **and** `completedLate`;
- `today` and `upcoming` contribute to `planned` and to **no** subtype count;
- `notPerformed` contributes to `planned` (when its row falls in the week) and
  to no other count — a record never reads as started, past-due or completed.

Therefore `completedEarly + completedLate ≤ completed`, and
`planned − completed − started − pastDue − notPerformed` is exactly the count
of occurrences dated today or later in the week.

Structural rules:

- a **window with zero planned occurrences is omitted** — never rendered as a
  fake zero week (the reported weeks are the non-empty ones, oldest first);
- **totals are the plain sum of the returned week rows**, so a reader can never
  see two disagreeing answers;
- `closed` is `now >= weekEnd`. The current/future window is **provisional, not
  failed**: M16 has no lifecycle vocabulary beyond `closed`, and no week is
  described as incomplete, missed or broken;
- occurrences dated outside every window (older than the horizon, or in a later
  week) are simply not part of the requested span: they appear in no week and
  no total.

**No percentages, no ratios, no adherence score** — and none may be added: the
report restates rows, it does not grade them.

## Current-calendar limitation

This is the load-bearing limitation of M16.

**M16 evaluates the CURRENT `planned_workouts` rows of the run.** Changing
training days (regeneration) or moving a planned workout replaces or relocates
those rows, so **earlier follow-through rows can change** after the calendar
changes. The report always describes today's calendar — it is an as-of-now
statement, never an audit of how the plan once looked.

- A **completed occurrence that has no current planned row is not injected back
  into the report.** It never was, or is no longer, on this calendar, and M16
  does not invent intent for it. The session itself remains valid execution
  history: M16 makes no claim that historical data was lost, and it is not a
  substitute for the history views (`/history`, exercise history, session
  detail), which remain the authority for what was trained.
- A **recorded occurrence that has no current planned row is not injected back
  into the report either.** It contributes only to `notPerformedUnplaced`
  (see below) and never to a week or total — M16 still never invents a date
  for it.
- **M16 does not reconstruct historical planning intent**, because Fit40 does
  not persist plan-version history. Regeneration is a whole-set replacement of
  rows with no audit trail (a deliberate M15 design choice), so no application
  can restate the old calendar — and M16 will not approximate one.
- The single approved disclosure carries this truth to the user:
  *“This describes the dates currently on your calendar. Changing your
  training days replaces them.”*

**History and current-calendar follow-through are different views** and are
never merged: history is what you did (all sessions, any plan state),
follow-through is how the current calendar held up.

## Recorded-not-performed projection (M17)

Since M17 the report also reads the run's recorded-not-performed facts. The
projection of one occurrence follows exactly three rows:

| | Current `planned_workouts` row? | Truth | Where it lands |
|---|---|---|---|
| 1 | yes | recorded fact | the occurrence's **week occurrence** — normal counts plus `notPerformed: +1` |
| 2 | no | recorded fact | **excluded from weeks and totals**, contributes **only** `notPerformedUnplaced: +1` |
| 3 | no | completed session (no record) | **history-only** — never injected into a week, and never counted as unplaced |

- `notPerformedUnplaced` is the **row-set difference** between the run's
  recorded occurrences and **all** of its current planned rows: every recorded
  occurrence with no current row counts, whenever its planned date was or
  whether it ever had one. It is **horizon-independent** — the 8-week window
  never affects it — and it counts unplaced *records*, not unperformed work.
  An occurrence with neither a row nor a fact contributes nothing to the
  report.
- The M16 spine remains the current planned rows: an occurrence is never
  appended to a week solely because it holds a fact, and the horizon constant
  stays `FOLLOW_THROUGH_WEEK_COUNT = 8`.
- The pointer copy (locked): `n recorded as not performed without a calendar
  date — see Training schedule`; it links to the M15 calendar, where the
  unplaced list and Undo live. M16 remains read-only: no record or undo
  control appears here, and no adherence percentage is added for the new
  count.

## M14 vs M16 semantics

Program completion and plan follow-through are **different questions with
different denominators**, and they are intentionally allowed to disagree:

| | M14 program completion | M16 plan follow-through |
|---|---|---|
| Question | is every *authored* workout of the run done? | how did the run's *current calendar* hold up? |
| Denominator | authored program structure (`scheduled_workouts` of the run) | current `planned_workouts` rows |
| Source | `isProgramComplete` + completed scheduled ids | eight outcomes over the current plan |
| Lifecycle authority | yes — completion/restart surface | no — read-only report below the calendar |

A run can be 8 of 24 authored workouts complete while reporting `1 of 3 done`
for the current week, because planning may start mid-run or the calendar may
move. **Do not merge the two concepts**, average them, or rank one against the
other: M14 owns "finished", M16 owns "how the calendar went".

## M13 vs M16

- **M13 weekly insights** are **user-global training activity** for the last 8
  UTC weeks (workouts, logged sets, still-standing personal bests) and work
  with or without an enrolled program.
- **M16** is **current-program-run calendar follow-through**: it needs an
  enrolled, configured run, and its counts come from the run's plan.

M16 is **not** user-global consistency analytics and must not be presented as
such. User-global consistency / long-horizon analytics is **deferred from M16**
(no milestone or date is promised here); if it ships, it will re-use M13's
user-global read rather than the run-scoped report, and it will not be built
from this DTO.

## Persistence & query model

M16 introduces **no new persistence object**: no M16 table, no schema change, no
migration, no index. Everything it reads already exists:

- **calendar intent** comes from the run's existing `planned_workouts` rows
  (`PlannedWorkoutRepository.listByEnrollment`), one row per
  `(enrollment_id, scheduled_workout_id)` by primary key;
- **completed occurrence activity** is a direct projection of existing
  `workout_sessions` rows for the run (the Slice 2 port method
  `listCompletedOccurrenceActivity`): occurrence identity plus the completion
  instant, ordered by `(completed_at, started_at, id)` for determinism only;
- **in-progress identities** reuse M15's existing `workout_sessions` projection;
- **recorded settlement** comes from the run's `not_performed_workouts` rows
  (M17's `NotPerformedOccurrenceRepository.listByEnrollment`) — counts only;
- **enrollment lookup** is the existing `ProgramEnrollmentRepository` read.

Invariants this relies on, all enforced by the database rather than by code:

- **one session per `(enrollment_id, scheduled_workout_id)`**
  (`workout_sessions_enrollment_occurrence_unique`), so each occurrence has at
  most one completion fact and one live fact;
- **detached sessions** (`enrollment_id` NULL) can never match a non-null
  enrollment id — they are excluded structurally, not filtered afterwards;
- planned rows are unique per occurrence per run, so no planned row can be
  counted twice.

Consequently:

- **there is no application-side or Domain-side deduplication.** The
  application builds exactly one fact per current planned row; a repeated
  `scheduledWorkoutId` is a **contract violation** and the Domain summarizer
  throws (`Follow-through contract violated: occurrence "…" was supplied more
  than once`) rather than merging two facts, because merging would report a
  number that matches neither source;
- the read is **five bounded statements** (enrollment lookup, planned rows, and
  the three independent reads — completed activity, in-progress ids,
  recorded-not-performed facts — issued together) — **no N+1**, no
  hydration of session aggregates or logs, no join across logs, no `DISTINCT`
  repair, and no write of any kind;
- presentation never reaches a repository: it consumes the DTO only, and the
  page wires the read through the feature composition root.

## Surfaces (UI)

**Program detail, immediately below the M15 training schedule/calendar section**
(`PlanFollowThroughSection`, above the authored "Weekly schedule" list). It is
a Server Component: no client state, no browser clock, no client fetch.

Framing and copy (locked):

- title: **“This plan so far”**; horizon hint: **“last 8 weeks”**;
- one row per reported week: range label, `"N of M done"`, optional `"n
  started"` / `"n past due"` / `"n not performed"`, and **“This week”** with `aria-current="date"`
  for the open week containing `today` (text + semantics, never colour);
- section totals as a factual line (`7 planned · 5 done · 1 completed early · …`,
  including an `n not performed` fragment when nonzero);
- the single current-calendar disclosure:
  **“This describes the dates currently on your calendar. Changing your
  training days replaces them.”** — M16 adds no other disclosure, and no UTC
  line (M15's two UTC lines are unchanged and still the only ones);
- `configured: false` (a run with no planned rows) renders **no M16 section at
  all** — no empty card, no zero weeks, no setup CTA. **M15 owns schedule
  configuration**;
- `ok(null)` (not enrolled), a completed run, and a failed read likewise render
  nothing; a failed read is logged and degrades this section only, never into
  `configured: false` or fabricated weeks.

Copy bans: `missed`, `failed`, `skipped`, `streak`, `adherence`, `score`,
`goal`, `on track`, `off track`, and any percentage. `past due`, `completed
early`, `completed late` and `recorded as not performed` are the approved
factual terms.

## Non-goals

Locked and deliberately absent:

- no **adherence percentage, ratio or score**;
- no **streak**;
- no **goal**, target or quota;
- no **on-track / off-track** verdict or any judgement of a provisional week;
- no **user-global consistency statistic** (deferred from M16 — see
  [M13 vs M16](#m13-vs-m16); no milestone or date is committed);
- no notifications or reminders;
- no calendar (ICS) integration;
- no timezone preference system (UTC weeks remain the single disclosed model);
- no historical plan / version reconstruction (none is persisted);
- no month calendar and no week navigation;
- no AI commentary;
- no M16 writes or mutations of any kind.

Deferred items are listed as *deferred*, not as a roadmap promise.

## Tests & acceptance evidence

- **Domain** (`tests/unit/domain/services/`):
  `plan-follow-through.test.ts` (outcome truth table, precedence, UTC
  midnight boundary, week bucketing, empty-window omission, totals = Σ rows,
  order-independence, no mutation, `closed` at the exclusive window end,
  duplicate-occurrence contract violation);
  `schedule-follow-through-parity.test.ts` (**the M15 drift guard**: shared
  fixture, real `resolvePlannedWorkoutStatus`, completed variants normalize to
  `completed`, all eight outcomes covered).
- **Application** (`tests/unit/application/use-cases/get-enrollment-follow-through.test.ts`):
  `INVALID_INPUT`, `ok(null)` with no downstream reads, `configured: false`
  with no session reads and no fabricated zeros, full assembly, completion
  precedence over a live fact, orphan activity ignored, the exact 8-week
  window/horizon, exact DTO key set, concurrent activity reads, no repository
  write, failures propagating instead of degrading to `configured: false`.
- **Presentation** (`tests/unit/features/schedule/`):
  `follow-through-view.test.ts` (labels formatted, DTO counts verbatim on
  deliberately self-inconsistent fixtures, empty horizon, `isCurrent` never
  recomputing `closed`, forbidden vocabulary and `%` scan);
  `plan-follow-through-section.test.ts` (unconfigured renders nothing, framing,
  rows, totals, current week text + `aria-current="date"`, disclosure once, no
  interactive elements, no forbidden vocabulary or percentage).
- **Page wiring** (`tests/unit/app/program-detail-page.test.ts`): placement
  below the M15 calendar, one already-hydrated program aggregate, one shared
  server clock, no catalog re-read, gates preserved (anonymous / not enrolled /
  completed run read nothing), failures logged and degraded to no section only,
  and a module guard that fails if presentation imports repositories.
- **Real PostgreSQL** (`tests/integration/database/follow-through-round-trip.test.ts`):
  planned rows + real sessions → the real use case → the Domain summary → the
  DTO: all eight outcomes across three reported weeks, empty windows omitted,
  `closed` from a fixed clock, totals = Σ rows, the unplanned completed
  occurrence stays history, another run and detached history contribute
  nothing, and the read is exactly five `SELECT`s with no write.
- **Architecture guards** (`tests/unit/architecture/follow-through.test.ts`):
  import boundaries per layer, Server Component (`no "use client"`), no M16
  persistence object, presentation only through the composition root, and the
  M16 presentation vocabulary/percentage bans in source.
- Totals are recorded by `docs/testing.md`.

## Commit chain (milestone_16)

1. `74ee725` feat(domain): add plan follow-through model (M16 Slice 1)
2. `b5374ce` fix(domain): reject duplicate follow-through occurrences (M16 Slice 1 correction)
3. `a64e75e` feat(sessions): add completed occurrence activity read (M16 Slice 2)
4. `735ea04` feat(application): add plan follow-through read (M16 Slice 3)
5. `58b9fd2` feat(schedule): add plan follow-through section (M16 Slice 4)
6. `9feeae7` feat(programs): show plan follow-through (M16 Slice 5)
7. `b0081e6` test(follow-through): verify real database round trip (M16 Slice 6)
8. docs(follow-through): document and guard milestone 16 (M16 Slice 7, this commit)
