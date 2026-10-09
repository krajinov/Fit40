# Training Progress & Long-Horizon Trends (M18)

Canonical reference for the M18 milestone: the product and metric semantics of
the dedicated **Progress surface**, the **13-week UTC horizon**, the
**training-activity metrics** (completed workouts, logged sets, external-load
volume), the **historical personal-record-event timeline**, and the
**first-vs-latest working-load comparison**. This document is a semantic lock,
written before implementation: every rule below is either an existing
repository contract M18 reuses verbatim, or a new rule stated precisely enough
that no business logic needs to be invented inside a UI component, a use case,
or a database adapter later.

M18 changes no M8 (progression), M12 (records), M14 (completion), M16
(follow-through) or M17 (settlement/closure) semantics, and no M13 behavior
beyond one **explicitly approved, presentation-only volume-label alignment**
(§6.4). Where M18 touches an existing shipped behavior, the change and its
approval are recorded in §6.4 — nothing is silently redefined.

## Contents

1. [Purpose and user questions](#1-purpose-and-user-questions)
2. [Existing repository foundations](#2-existing-repository-foundations)
3. [Locked product scope](#3-locked-product-scope)
4. [Metric taxonomy and eligibility](#4-metric-taxonomy-and-eligibility)
5. [UTC horizon and week boundaries](#5-utc-horizon-and-week-boundaries)
6. [External-load volume semantics](#6-external-load-volume-semantics)
7. [Exercise working-load comparison](#7-exercise-working-load-comparison)
8. [Historical PR-event timeline semantics](#8-historical-pr-event-timeline-semantics)
9. [Historical ownership and attribution](#9-historical-ownership-and-attribution)
10. [Empty, sparse, and degraded states](#10-empty-sparse-and-degraded-states)
11. [Allowed / prohibited product language](#11-allowed--prohibited-product-language)
12. [Cross-surface ownership and boundaries](#12-cross-surface-ownership-and-boundaries)
13. [Invariants and acceptance examples](#13-invariants-and-acceptance-examples)
14. [Explicit non-goals](#14-explicit-non-goals)
15. [Remaining genuine decisions](#15-remaining-genuine-decisions)

---

## 1. Purpose and user questions

M18 answers, exactly, from the user's own completed training history:

| # | User question | Answered by |
|---|---|---|
| 1 | "How consistently have I trained over the last quarter?" | Weekly completed workouts and logged sets over the 13-week horizon (§5, §4.1, §4.2), and the period average (§4.5) |
| 2 | "How much loaded work have I done, week to week?" | External-load volume per week and for the period (§6) |
| 3 | "What personal bests did I set in this period, and do they still stand?" | Historical PR-event timeline with still-stands/surpassed context (§8) |
| 4 | "How has my working load on one exercise moved in this period?" | First-vs-latest working-load comparison (§7) |
| 5 | "What should I understand about my recent training?" | The factual period summary (§4.4) assembled from 1–4 |

M18 never answers — and never attempts to answer — "am I stronger / fitter /
recovered / on track?" Those are interpretations, not facts, and they are
prohibited vocabulary (§11).

---

## 2. Existing repository foundations

M18 is read-time derivation over existing facts. Every contract below is
reused verbatim; nothing is re-implemented.

| Contract | Location | What M18 reuses |
|---|---|---|
| UTC training weeks | `src/domain/services/training-week.ts` | Monday 00:00:00.000 UTC `[start, end)` windows; `listRecentTrainingWeekWindows(now, count)` (final entry = current week); `summarizeTrainingWeeks` bucketing by `completedAt`; "a week without completed sessions is an authoritative zero" |
| Session metrics | `src/domain/services/session-metrics.ts` | `calculateSessionMetrics`: `volume = Σ (reps × weightKg)` over rep sets with `weightKg !== null`; duration sets and bodyweight rep sets excluded; `0 kg` contributes zero — the locked volume rule |
| Occurrence working load | `src/domain/services/occurrence-working-load.ts` | `resolveOccurrenceWorkingLoad`: minimum external load across the occurrence's performed sets; any null-weight set or duration prescription ⇒ `unloaded`; `0 kg` is external |
| Record taxonomy & positions | `src/domain/services/personal-record-metrics.ts` | `max-load` / `max-bodyweight-reps` / `max-duration`; `PerformancePosition` ladder (`completedAt, startedAt, sessionId, exerciseOrder, setNumber`); strict-greater rule; `0 kg` is a real load |
| Record resolution | `src/domain/services/personal-records.ts` | `extractRecordCandidates` (performed-id attribution, set-level candidates, skipped/set-less contribute nothing); `resolveRecordEvents` (first exposure + strictly greater); `foldPersonalRecords` as the integration-test oracle |
| Record reads | `src/application/ports/personal-record-repository.ts` | `findCurrentPersonalBests` (batched, exact); `findBestValuesBefore` (exact, user-global, strictly-before, one batched round trip, no top-K) |
| History reads | `src/application/ports/training-history-repository.ts` | User-global, completed-only, detached-inclusive reads: `listCompletedSessionActivity(userId, since)` (since inclusive, no page-size bound), `listCompletedExerciseOccurrences` (bounded display window, `EXERCISE_HISTORY_OCCURRENCE_LIMIT = 50`), `getTotals` |
| Insight composition | `src/application/use-cases/get-training-weekly-insights.ts`, `src/application/dto/training-insights.ts` | The M13 pipeline shape: one caller-supplied request clock, bounded batched reads, truthful `unavailable` states, newest-first PB selection |
| Period PR-event precedent | `src/application/use-cases/get-program-completion-summary.ts`, `src/application/dto/program-completion.ts` | Candidates scoped to a session set → user-global `findBestValuesBefore` → `resolveRecordEvents`; exact count never capped by the display cap; catalog-unresolved rows omitted without changing the count |
| Presentation patterns | `WeeklyActivityStrip`, `ExerciseHistoryTrend`, `WeeklyInsightsCard` | Text-first accessible charts (SVG as decoration), ≥2-points-before-a-line rule (`MIN_TREND_POINTS_FOR_CHART = 2`), zero-floor weeks, honest "couldn't load" states |

Note: `docs/training-history.md` does **not** exist. M13 history semantics are
canonical in `docs/ui.md` screen notes plus the port's doc contracts, which
this memo cites directly.

---

## 3. Locked product scope

### 3.1 In scope

- A dedicated **`/progress`** route (Progress surface), added to the **desktop
  primary navigation** (`AppNavLinks`).
- **Mobile access through existing links** (dashboard and history surfaces),
  with **no fifth mobile tab** — the locked 4-slot `MobileTabBar` is unchanged.
- The **dashboard gets a link only** — no new analytics calculations, no new
  reads, no new card. M13's "This week" card, recent-PBs card and activity
  strip stay the dashboard's only insight surfaces.
- 13-week training-activity trend (completed workouts, logged sets per week).
- 13-week external-load volume trend (§6).
- Historical PR-event timeline for the period (§8).
- Factual period summary (§4.4).
- Exercise-history upgrades: PR-event markers on the working-load trend (§8.6)
  and the first-vs-latest working-load context line (§7).
- **Approved presentation-only alignment** of the existing History and
  completed-session volume badges to M18's unit and presence semantics (§6.4)
  — copy, view mapping and presentation tests only; the domain calculation and
  every repository/SQL path are unchanged.

### 3.2 Out of scope (locked)

- New training prescriptions, recommendations, or any M8 interaction.
- Any change to M8/M12/M14/M16/M17 semantics, copy, or surfaces; any change to
  M13 surfaces beyond the approved §6.4 presentation alignment.
- Bodyweight-rep or duration performance trends (context-dependent; deferred).
- Recovery, deload, readiness, or fatigue anything.
- Program matching, program discovery changes, notifications.
- New tables, migrations, persisted analytics state, or derived writes — M18
  is read-time derivation, exactly like M12 and M13.
- A user-selectable horizon (no URL parameter, no control) in M18.

---

## 4. Metric taxonomy and eligibility

| Metric | Classification | Verdict |
|---|---|---|
| Completed workouts per week | DIRECT FACT | Include (§4.1) |
| Logged sets per week | DIRECT FACT | Include (§4.2) |
| External-load volume per week | SAFE DERIVED | Include, labeled `kg × reps` (§6) |
| Period totals (workouts, sets, volume, PR events) | DIRECT FACT / SAFE DERIVED | Include (§4.4) |
| Average completed workouts per week | SAFE DERIVED | Include, anchored denominator (§4.5) |
| Historical PR events per period | DIRECT FACT (M12 resolution) | Include (§8) |
| First-vs-latest working load | SAFE DERIVED | Include (§7) |
| Bodyweight-rep trends, duration trends, RPE aggregates, elapsed-time averages | CONTEXT-DEPENDENT | Defer (not M18) |
| e1RM, bodyweight volume, readiness/fatigue, adherence %, streaks, calories, composite scores | SHOULD NOT CALCULATE | Never (§11, §14) |

### 4.1 Completed workouts per week
- **Source facts:** sessions owned by the user with `completedAt` in the week
  window, from the user-global completed-only read (detached included).
- **Inclusion:** every completed session counts as one workout — including a
  legacy zero-set completed session (1 workout, 0 sets), the M13 rule.
  In-progress sessions never appear. Not-performed occurrences have no session
  and never appear.
- **Formula:** `count(completedAt ∈ [weekStart, weekEnd))`.
- **Label:** "Workouts" / "completed workouts".
- **Missing-data behavior:** a week with none is an authoritative zero and
  renders `0`.
- **Edge example:** a session started Sunday 23:30 UTC and completed Monday
  00:10 UTC counts in the **Monday** week (completion attribution).

### 4.2 Logged sets per week
- **Source facts:** the same sessions; per-session `loggedSets` = plain count
  of persisted set rows (the activity-read contract).
- **Formula:** `Σ loggedSets` of sessions completed in the week.
- **Label:** "Sets" / "logged sets".
- **Missing-data behavior:** a week with training but zero persisted set rows
  reports `0` (defensive guarantee for legacy data; the domain completion gate
  never produces it).
- **Edge example:** a completed session whose only occurrence was skipped
  counts 1 workout, 0 sets — never hidden.

### 4.3 External-load volume per week
Defined fully in §6 (unit, presence, genuine zero, approved alignment).

### 4.4 Period totals
- **Scope:** all 13 windows **including the current partial week**.
- **Totals:** total completed workouts; total logged sets; total
  external-load volume (with §6.3's presence rule — if no week in the period
  had eligible loaded sets, the total renders no value, never 0); total
  historical PR events established in the period (§8).
- **Factual period summary:** one line assembled from these facts only, e.g.
  "28 workouts · 312 sets · 3 personal bests · 2.3 workouts per week on
  average (since your first completed workout in this period)". Direction
  words, verdicts, and percentages are prohibited (§11).
- **Edge example:** a user whose only training is bodyweight sees "12
  workouts · 96 sets · no personal bests…" with the volume fact absent, never
  "0 kg × reps".

### 4.5 Average completed workouts per week

- **Numerator (locked):** completed workouts in the **12 completed (full)
  weeks** — the current partial week is excluded from the average (a
  partially elapsed week would deflate it; its count is already visible as
  "This week").
- **Denominator (locked):** the number of completed weeks from the week
  containing the user's **first completed workout within the horizon** through
  the horizon's **last completed week** (the week before the current partial
  week). If the first in-horizon completed workout falls in the k-th window
  (1-based, oldest first, k ≤ 12), the denominator is `13 − k`.
  - **Interior weeks without training count.** A gap inside the measured span
    is a real zero and is precisely the consistency being measured.
  - **Trailing inactive completed weeks count.** Stopping training reduces the
    average; recent absence is part of recent consistency (acceptance dataset
    P).
  - **Weeks before the first in-horizon completed workout are excluded.**
    They are pre-tracking weeks: `training-week.ts` documents that the data
    model cannot distinguish "did not train" from "not yet training", so the
    average never fabricates an untracked past into its denominator (dataset
    N). Weeks before the first trained week necessarily hold zero workouts,
    so numerator and denominator are always consistent.
- **Why this rule:** one anchor (the first in-horizon completed workout's
  week) and one fixed end (the last completed week) — no "last trained week"
  bookkeeping, no activity-span arithmetic; explainable in a single sentence.
- **Formula:** `numerator ÷ denominator`, displayed with at most one
  fractional digit (en-US, half-up): `27 ÷ 12 = 2.25 → "2.3"`.
- **Label (locked):** states its basis in words — "average workouts per week
  **since your first completed workout in this period**". The phrase "weeks
  you trained" is prohibited for this metric: interior and trailing zero weeks
  are counted.
- **Missing-data behavior:** no completed workouts in the 12 completed weeks ⇒
  **no average renders** (never "0.0"); the first completed workout inside the
  current partial week ⇒ no completed training weeks yet ⇒ no average;
  exactly one completed training week ⇒ the average renders with denominator 1
  and the same basis wording.
- **Edge example:** a user whose account is 5 weeks old training 3×/week:
  `15 ÷ 5 = "3.0"` — never `15 ÷ 12 = "1.3"`.

---

## 5. UTC horizon and week boundaries

1. **Composition (locked):** the horizon is **the current partial UTC week
   plus the 12 preceding completed weeks** — exactly
   `listRecentTrainingWeekWindows(now, 13)`, whose final entry is the week
   containing `now`. This matches M13's 8-week insight convention and M16's
   "last 8 weeks including this week" convention. The alternative (13 fully
   completed weeks, excluding the current week) is rejected: it would make the
   surface's newest week stale by up to 6 days and diverge from every existing
   week-scoped surface.
2. **Window boundaries:** Monday 00:00:00.000 UTC inclusive → next Monday
   00:00:00.000 UTC exclusive; contiguous, non-overlapping; an instant belongs
   to exactly one window (existing `training-week.ts` rule).
3. **`since` bound:** the oldest window's `weekStart`, **inclusive** —
   matching `listCompletedSessionActivity`'s inclusive `since`. Sessions older
   than the horizon are ignored, not an error. No upper bound is needed:
   `completedAt` cannot exceed the request clock that wrote it, and the
   current window's end is a future instant.
4. **Attribution (locked):** a session belongs to the week containing its
   **`completedAt`** — never `startedAt`. A Sunday-started, Monday-completed
   session is Monday-week training. This is M13's existing bucketing rule,
   inherited verbatim.
5. **Zero-activity weeks:** every one of the 13 weeks renders, with an
   authoritative zero (the activity-strip zero-floor convention). Gaps in
   activity are represented as visible zeros, never omitted. (M16 omits
   zero-*planned* weeks — a different denominator; M18 does not copy that
   rule.)
6. **Partial-week labeling:** the current week is labeled "This week" and
   marked `aria-current="date"` (words + semantics, never color alone — the
   M15/M16 convention). Period totals include it (§4.4); the average excludes
   it (§4.5).
7. **Clock:** one caller-supplied `now` per request, captured at the
   presentation boundary — the `issue-session`/M13 convention. No application
   or domain code calls `Date.now()`; no browser clock.
8. **No selector:** the horizon is fixed at 13 windows in M18. No URL
   parameter, no control, no per-user setting.

---

## 6. External-load volume semantics

### 6.1 Eligibility and formula

- **Eligible contribution (locked):** a **rep set with `weightKg !== null`**
  contributes `reps × weightKg`. `0 kg` is a real external load and
  contributes `0`. Duration sets contribute nothing. Bodyweight rep sets
  (`weightKg === null`) contribute nothing. This is
  `calculateSessionMetrics`'s existing volume rule, reused verbatim — never
  re-implemented in SQL logic that could drift.
- **Week volume:** `Σ` of session volumes over sessions completed in the
  week.
- **Period volume:** `Σ` over the 13 windows.

### 6.2 Unit and label

- **Unit (locked): the value is load × repetitions, and the label must say
  so.** Canonical display unit: **`kg × reps`** (e.g. "6,000 kg × reps"),
  chosen because the design vocabulary already uses "×" for load × reps in
  set lines ("50 kg × 10"). Metric label: **"External load"**; full label
  "External load (kg × reps)". "kg-reps" is an accepted space-tight
  abbreviation. **Never label the value as plain "kg"** — a kilogram is a
  mass, not a load×reps quantity, and calling it "kg" invites misreading as
  weight moved or strength.
- **Rounding:** whole numbers with en-US grouping.

### 6.3 Genuine zero vs. no eligible data (locked)

- A week **has eligible external-load data** iff at least one rep set with
  `weightKg !== null` was logged in a session completed in that week.
- **Present ⇒ display the sum**, even when the sum is exactly `0` (all logged
  loads were `0 kg`) — a genuine zero.
- **Absent ⇒ display no value** (—/omitted), **never `0`**: a bodyweight-only
  or duration-only week is *unloaded training*, not *zero loaded training*,
  and must not appear as zero training activity. Workouts and sets for that
  week still display normally (§4.1, §4.2).
- The same presence rule applies to the period total and — since the approved
  §6.4 alignment — to the existing History and completed-session volume
  badges.

### 6.4 Approved alignment of the existing volume presentation

The following **narrow, presentation-only change is explicitly approved** for
M18; the Domain calculation and every repository/SQL path are preserved
unchanged:
- History and completed-session volume badges label the value **`kg × reps`**
  (via `formatHistoryVolume`), not plain "kg".
- Badge presence follows §6.3's eligibility rule (the session contains ≥1 rep
  set with `weightKg !== null`): a session whose only loaded sets were `0 kg`
  displays **"0 kg × reps"** (a genuine zero); a bodyweight/duration-only
  session displays **no volume badge** (no eligible data). This replaces the
  current `volume > 0` suppression, which conflates the two cases.
- The change lives in presentation copy, view mapping, and their unit tests,
  updated during implementation. This is an in-scope M18 item (§3.1), not a
  follow-up: M18 surfaces and the existing history surfaces render the same
  metric with the same unit and the same zero/absence semantics.

### 6.5 Projection discipline

Any SQL aggregation of weekly volume is a projection that must be verified in
integration tests against `calculateSessionMetrics` as the oracle — the M12
pattern (`foldPersonalRecords` oracle vs. SQL projection). The domain rule
stays the single semantic authority.

---

## 7. Exercise working-load comparison

1. **Eligible occurrences (locked):** completed occurrences of the
   **resolved (performed) exercise** with at least one logged set, whose
   `resolveOccurrenceWorkingLoad` result is `external`. Bodyweight and
   duration occurrences are excluded (no truthful single load exists — the
   existing trend's own rule). Skipped/set-less occurrences are not
   performances and never participate.
2. **Ordering ladder (locked):** occurrences are totally ordered ascending by
   `completedAt`, then `startedAt`, then `sessionId`, then `exerciseOrder` —
   the existing history recency ladder reversed, and `PerformancePosition`
   minus `setNumber`. Ties are therefore never ambiguous: two occurrences of
   one exercise inside one session resolve to distinct positions (the later
   `exerciseOrder` is "later").
3. **Definitions:** **First** = the ladder-minimum eligible occurrence
   **completed within the 13-week horizon**; **Latest** = the ladder-maximum
   eligible occurrence completed within the horizon. The comparison is
   **period-scoped by design** so that truncation of the bounded
   50-occurrence display window can never change it, and it is labeled with
   its period ("in the last 13 weeks"). An all-time first-exposure comparison
   is explicitly deferred (§14).
4. **Display (locked):** a factual statement of both values with dates, e.g.
   "Working load in the last 13 weeks: 20 kg (Jun 2) → 22.5 kg (Sep 8)".
   Direction is worded factually — **increased / unchanged / decreased** — in
   words, never a percentage, never error styling for a decrease (supportive
   framing, the M8 amber convention). "Unchanged" renders when first and
   latest loads are exactly equal.
5. **Fewer than two points:** fewer than two eligible loaded occurrences in
   the horizon ⇒ **no comparison renders**, with the honest note "Not enough
   loaded workouts of this exercise in the last 13 weeks to compare." One
   point never draws a slope (the ≥2-points rule).
6. **Missing values:** unloaded occurrences inside the horizon simply do not
   participate; if **all** in-horizon occurrences are unloaded, the existing
   "no external load was logged" note applies and no comparison renders.
7. **Prohibited:** estimated 1RM, strength percentages, "you got stronger",
   any projection beyond the two facts.

---

## 8. Historical PR-event timeline semantics

### 8.1 Pipeline (M12 verbatim, M14 pattern)

Sessions completed within the 13-week horizon (user-global, any program,
detached included) → `extractRecordCandidates(session)` →
`findBestValuesBefore(userId, candidates)` → `resolveRecordEvents(priorBests)`.
Candidate **origin** is period-scoped; prior-best evaluation stays
**user-global and exact** (all history before each position — including
history older than the horizon), so "a PR event during this period" means what
was true at that point in history. `findCurrentPersonalBestsSetBetween` is
deliberately **not** used — that is M13's still-standing semantics and answers
a different question.

### 8.2 Read strategy and exactness (locked)

The timeline is answered with a **bounded number of batched database
statements** while the **candidate set and the event count remain uncapped**.
These are different things, and only the first is ever bounded:

1. **One horizon session read** — the user's sessions completed in the horizon
   window, user-scoped, detached included, with batched exercise/set-log
   hydration (the M13/M14 statement-count discipline: a constant number of
   statements, never one per session). The horizon bounds **which sessions
   can contribute candidates** — that is the question's own scope ("events
   established in this period"), not an artificial cap on event counting.
2. **One batched `findBestValuesBefore` call** carrying **every** candidate
   extracted from those sessions — every eligible logged set of every
   in-horizon session, with no top-K, no page size and no candidate ceiling.
   The port's existing contract ("the whole candidate collection is answered
   in one batched query"; "no bounded window, page size, or top-K
   over-fetch") is the exactness guarantee: prior-best evaluation sees
   **complete user-global history strictly before each candidate's position**,
   including history far older than the horizon.
3. **Zero queries for resolution** — `resolveRecordEvents` is pure domain
   logic; each paired candidate either is an event (first exposure, or
   strictly greater than its exact prior best) or is not. Event truth never
   depends on array order: each candidate carries its own
   `PerformancePosition`, and the port pairs results by the candidate object
   itself. The timeline's chronological order is computed from the position
   ladder, never from array order.
4. **One batched `findCurrentPersonalBests` call** over the distinct
   performed-exercise ids of the **displayed** (capped) events — still-stands
   context only (§8.5). It never influences the count and is skipped entirely
   when nothing can render.
5. **One batched catalog read** for display names, skipped when nothing can
   render (the M13 convention).

Consequences, locked:

- The **event count is exact** for the period: every event whose establishing
  set completed inside the horizon is counted. The only bound anywhere is the
  **display** cap (newest 10 rows), which never rewrites the count (the M14
  count-vs-cap rule).
- The 13-week window scopes **candidate origin, never prior-best
  evaluation**: an event gated by a prior best from outside the horizon
  (older weeks, other programs, detached sessions) is resolved exactly as M12
  defines it (acceptance dataset D).
- No per-event, per-exercise or per-session repository round trips ever appear
  in the timeline path. A growing history grows the **data volume inside the
  bounded statements**, never the **number** of statements.

### 8.3 Counting (locked)

The period's "personal bests set" count is the number of **record events** —
one per logged set that strictly exceeded every eligible value before it
(first exposures included). It is **not** a count of qualifying sets (an
event's own set is the only qualifying set), and **not** a count of distinct
exercises. The count is **exact and never capped** by any display limit.
Distinct-exercise counts may appear only as grouping/display, never as the
headline count.

### 8.4 Timestamp attribution and ordering

An event's date is its **`PerformancePosition.completedAt`** (the owning
session's completion), bucketed into weeks by the same `[start, end)` rule as
activity. The timeline lists events **ascending by the full position ladder**
(`completedAt, startedAt, sessionId, exerciseOrder, setNumber`) — never a
date-only sort, never insertion order.

### 8.5 Display list and still-stands context (locked)

- Display list: the **newest 10 events** (cap applied after the exact count
  is known; the stated count is unaffected — the M14 rule; the cap value is
  tunable, §15).
- Each displayed event may link to its owning session and shows: exercise
  name, metric, value, `previousBest` (or "first time"), and exactly one
  context state:
  - **"Still your best"** — iff the event's own position **is** the current
    best's owning position for that (performed exercise, metric), resolved by
    one batched `findCurrentPersonalBests` over the displayed events'
    exercises. (M12 ownership: on equal maxima the earliest owner keeps the
    best, and a current-best owner is always itself an event, so position
    equality is exact and sufficient.)
  - **"Since surpassed"** — otherwise (a strictly greater value exists later
    in history).
- A later equal value never marks an event surpassed (M12 earliest-equal
  ownership); an equal earlier value cannot exist for an event (strict-greater
  rule).
- Catalog-unresolved exercise ids are omitted from rows, never
  placeholder-named, and never change the count (M14 rule).

### 8.6 Exercise-history trend markers (locked)

- **The 50-occurrence bound limits presentation only.**
  `EXERCISE_HISTORY_OCCURRENCE_LIMIT = 50` bounds which occurrences are
  displayed (entries, trend points, and therefore which occurrences *can
  carry* a marker). It **never bounds detection**.
- **Detection uses complete user-global prior history.** For each displayed
  occurrence, its sets are candidates; `findBestValuesBefore` evaluates **all**
  eligible history strictly before each candidate's position — including
  bests and events established before the displayed window (e.g. an all-time
  best set months before the window). A displayed set that equals or falls
  short of an out-of-window prior best is correctly **not** an event; a
  displayed set with no eligible prior at all is a first-exposure event
  (acceptance dataset Q).
- **M12 semantics preserved verbatim:** strict-greater only (an equal value
  never establishes an event); earliest-equal ownership stays with the older
  set; first exposure is an event; `max-load` eligibility is rep sets with
  `weightKg !== null` (`0 kg` eligible).
- **Marker rule:** a trend point is marked iff its occurrence identity
  `(sessionId, exerciseOrder)` contains at least one resolved `max-load`
  event under the above rules. Marker meaning: "this workout contains a set
  that established a max-load personal record at that time" — never that the
  plotted working load is the record value.
- **`max-load` events only** land on trend points (the trend is the
  externally loaded subsequence); `max-bodyweight-reps` and `max-duration`
  events belong to unloaded occurrences, have no point to mark, and remain
  visible through the Personal Bests cards and the §8 timeline. An event on
  an occurrence outside the displayed window simply has no point to mark —
  presentation, not detection.
- Read strategy mirrors §8.2: the screen's existing bounded window read, one
  batched `findBestValuesBefore` over the window's candidates (priors
  user-global), zero resolution queries. Markers need no current-best read —
  they are historical events, not standing-best statements.

### 8.7 Dashboard unchanged

M13's dashboard behavior is untouched:
`findCurrentPersonalBestsSetBetween` (still-standing bests, 8 weeks,
"Current PBs set this week", recent-PBs card cap 5). The two surfaces answer
different questions with distinct copy — dashboard: current standing;
Progress: what happened, with surpass context.

---

## 9. Historical ownership and attribution

- **User-global.** Analytics scope to sessions owned by the user, regardless
  of enrollment — the training-history port contract.
- **Leave:** detached sessions (enrollment `ON DELETE SET NULL`) remain the
  user's training past and count everywhere (activity, volume, PR events,
  working load).
- **Restart:** the M14 atomic replace preserves training history, PBs, and
  progression inputs by construction; M18 needs no new survivorship rule and
  adds none.
- **Substitution:** attribution always follows the **performed ExerciseId**
  (M12's locked rule); the authored exercise receives nothing.
- **User-added occurrences:** fully eligible (volume, PR events, trend,
  comparison) — M12 precedent; `source` is display context, never a filter.
- **Skipped occurrences:** contribute nothing (no logged sets — the
  mutual-exclusion domain rule).
- **Not-performed occurrences (M17):** contribute nothing to any training
  metric — they hold no session. They remain exclusively M16's run-scoped
  report subject. The two truths are never merged, averaged, or netted.
- **No new persistence:** no tables, migrations, caches, or derived writes.
  Every value is re-derived at read time (the M12/M13 model). Performance is a
  read-shape concern, never a semantic one.

---

## 10. Empty, sparse, and degraded states

| State | Locked behavior |
|---|---|
| No completed workouts in the horizon | Activity renders 13 truthful zero weeks + factual empty copy ("No completed workouts in the last 13 weeks."); volume renders absence; PR section renders its empty copy; **no average** (§4.5); no fabricated zeros-as-insight |
| Workouts, but no external-load sets anywhere | Workouts/sets render; volume per week and period total render **no value** with the honest note "No loaded sets in the last 13 weeks." — never 0 |
| Only bodyweight or duration training | Identical to the previous row by rule; bodyweight/duration training is never "zero training" |
| Week with only `0 kg` loads | Volume displays **0 kg × reps** (genuine zero, §6.3) |
| One working-load observation (first-vs-latest) | No comparison; honest "not enough loaded workouts" note; never a single-point slope |
| One trend point (markers/period) | Existing ≥2-points rule inherited; honest note, no fabricated slope |
| Gaps in weekly activity | Visible zero weeks (§5.5) — represented, never hidden or interpolated |
| Exactly one completed training week | Average renders with denominator 1 and the same basis wording (e.g. "3.0"); no special single-week state |
| Trailing inactive completed weeks | Count in the average's denominator (§4.5) — the average declines honestly; the weekly chart shows the zeros |
| Unavailable read model | The M13 pattern, per card: a truthful "Couldn't load …" state; **never zeros**, never conflated with the genuine empty state; logged at the page, degraded card-by-card |
| Catalog identity unresolved for a PR event | Row omitted; count unaffected (§8.5) |
| Legacy zero-set completed session | 1 workout, 0 sets (§4.1–4.2 defensive guarantee) |
| Mixed loaded/unloaded occurrences | Each rule applies per set / per occurrence; no imputation of missing loads, no averaging across load kinds |

---

## 11. Allowed / prohibited product language

**Allowed (factual):** completed workouts · logged sets · external load
(kg × reps) · working load · personal best set on [date] · first time ·
still your best · since surpassed · average per week **since your first
completed workout in this period** (stating its basis) · increased /
unchanged / decreased (working-load direction, in words) · "This week" ·
"last 13 weeks".

**Prohibited (locked bans, extending M16's list):** adherence / percentage of
plan · streak · missed, failed, skipped (as a *workout* verdict; "skipped"
remains the M10 *exercise-level* fact on session screens only) · on-track /
off-track · recovery, readiness, fatigue (any score or verdict) · strength
score, fitness score, fitness age · e1RM or any estimated maximum · "you're
getting stronger/fitter", improvement claims beyond stated facts · goals,
quotas, targets · **"weeks you trained" (as the average's basis — interior
and trailing zero weeks are counted)** · training time (for volume or
timed-work sums; elapsed is wall-clock only and not an M18 metric) · calories
· gamification vocabulary (trophies, confetti, XP — M12's ban).

**Separation rule:** every M18 sentence is either an observation ("You
completed 28 workouts") or a labeled derivation ("External load: 6,000 kg ×
reps"). Interpretations ("great consistency", "strong quarter") appear
nowhere.

---

## 12. Cross-surface ownership and boundaries

| Surface | Owns | Never does |
|---|---|---|
| Dashboard (`/dashboard`) | "This week" snapshot (M13), up-next, calendar, recent PBs; a link to `/progress` | Long-horizon calculations; any new analytics read |
| Progress (`/progress`) — new | The 13-week horizon: activity, external load, PR-event timeline, period summary | Current-week framing; recommendations; run-scoped anything |
| History (`/history`, `/history/exercises/[slug]`) | The archive: paginated sessions, per-exercise 50-occurrence window, working-load trend (+ §8.6 markers, §7 comparison line); volume badges render per the approved §6.4 alignment | Period-level aggregation; any semantic change to volume (the domain calculation is untouched) |
| Program detail | Run-scoped M16 follow-through report; M14/M17 lifecycle | User-global analytics |
| M12 records | Record detection, ownership, exactness — unchanged | Feeds progression or gets new metrics |
| M8 progression | Advisory next-target states — unchanged | Consumes anything from M18 |

---

## 13. Invariants and acceptance examples

**Invariants (each must hold for every rendered value):**

1. Every displayed number traces to a named domain rule (§2 table) or a rule
   in this memo.
2. Completion attribution is `completedAt`, windows `[start, end)`, UTC Monday
   weeks, one window per session.
3. Volume = §6.1 eligibility only; presence per §6.3; unit `kg × reps`.
4. PR events: M12 strictness, performed-id attribution, user-global priors,
   exact count, uncapped by display.
5. Detached sessions count; not-performed occurrences never produce training
   facts; skipped occurrences contribute nothing.
6. No fabricated zeros, slopes, percentages, or verdicts in any state (§10).
7. No `Date.now()` below the presentation boundary; one request clock.
8. SQL projections verified against their domain oracles in integration tests
   (volume: `calculateSessionMetrics`; PR events: `foldPersonalRecords`).
9. The PR-event timeline and markers are answered by a **bounded number of
   batched statements with an uncapped candidate set and an exact,
   never-truncated event count** (§8.2).
10. The 50-occurrence exercise-history bound limits **presentation only**;
    marker detection evaluates complete user-global prior history (§8.6).

**Acceptance matrix** (representative datasets; horizon = weeks W1…W12
completed + W13 = current partial):

| # | Dataset | Expected output |
|---|---|---|
| A | 13 mixed weeks: W1 3 workouts/30 sets/6,000 kg×reps; one interior zero week (W6); W13 (current, Wednesday) 1 workout; period totals 28 workouts/312 sets/61,200 kg×reps; **first completed workout falls in W1** | 13 weekly rows (the W6 zero visible); totals include the current partial week; volume present; average = (28−1) ÷ 12 = 2.25 → **"2.3"** — the denominator counts all 12 completed weeks from W1 (the first trained week), including the interior zero week |
| B | Bodyweight/duration-only weeks | Workouts/sets render; per-week volume **—**; period volume absent with note; no "0 kg × reps" |
| C | Only loaded sets are `0 kg × 10` (week W4) | W4 volume displays **0 kg × reps** (genuine zero) |
| D | PR ladder: 20 kg (15 weeks ago, outside horizon), 22.5 (W6), 22.5 again (W8, equal), 25 (W9, current best) | Events in period = **2** (W6, W9); W6 shows "Since surpassed"; W9 shows "Still your best"; the W8 equal set is not an event; the 20 kg prior best still gates W6 (user-global priors) |
| E | PR: first-ever exposure inside the horizon (no prior eligible history) | Event with `previousBest = null` → "first time"; counts |
| F | First-vs-latest: loads 20 (W1) → 22.5 (W12) | "20 kg (date) → 22.5 kg (date), increased" — in words, no % |
| G | First-vs-latest: 20 (W1) → 20 (W12) | "unchanged" |
| H | First-vs-latest: 20 (W1) → 17.5 (W12) | "decreased" — factual wording, no error styling, no coaching |
| I | First-vs-latest: exactly one loaded occurrence in horizon | No comparison; honest note |
| J | Substitution: authored split squat performed as goblet squat, 24 kg | Occurrence counts toward **goblet squat** (volume, trend, PR, comparison); split squat receives nothing |
| K | Detached session (program left) completed in W5 | Counts in W5 workouts/sets/volume; its sets produce PR candidates like any other |
| L | Not-performed occurrence in W7; one skipped exercise inside an otherwise completed W7 session | W7 workout counts (the session exists); skipped exercise contributes 0 sets, no volume, no PR; the not-performed occurrence appears in **no** M18 metric (M16's report alone) |
| M | Session started Sunday 23:30, completed Monday 00:10 | Counts in the **Monday** week (boundary rule §5.4) |
| N | User's training history is 5 weeks old; 15 workouts, all in W8–W12, none earlier | Numerator 15; first trained completed week W8 → denominator 5 (W8–W12); average **"3.0"** — pre-tracking weeks W1–W7 are excluded, never counted as zeros |
| O | First completed workout yesterday (inside the current partial week W13) | Workouts total 1; no completed training weeks → **no average** (never "0.0"); other sections render their empty states |
| P | Trained W1–W8 (24 workouts), none in W9–W12 (trailing inactivity) | Numerator 24; denominator 12 (first trained week W1 — all completed weeks count); average = 2 → **"2"** — the four trailing inactive completed weeks reduce the average honestly |
| Q | Markers with out-of-window priors: the exercise's all-time best 30 kg was logged 9 months ago (outside the displayed 50-occurrence window); the displayed occurrences log 27.5 kg, then 30 kg (equal), then 32.5 kg | 27.5 → **no marker** (27.5 < 30 prior best — strict-greater fails); 30 kg equal → **no marker** (equal is not an event; earliest-equal ownership stays with the 9-month-old set); 32.5 → **marker** (strictly greater than the 30 kg prior). Detection considered the out-of-window prior; only displayed points carry markers |

---

## 14. Explicit non-goals

- No new prescriptions or M8 interaction; no changes to M8/M12/M14/M16/M17
  semantics, copy, or surfaces; no changes to M13 surfaces beyond the approved
  presentation-only volume-label/presence alignment (§6.4).
- No bodyweight-rep or duration performance trends (deferred: no domain rule
  yet defines "the" bodyweight/duration performance of an occurrence).
- No all-time first-vs-latest (deferred: needs an oldest-loaded-occurrence
  read; the period version ships first).
- No RPE analytics; no elapsed-time averages; no muscle-group distribution.
- No recovery/deload/readiness/fatigue; no adherence, streaks, scores,
  quotas, or verdicts.
- No program matching/discovery, notifications, or calendar changes.
- No new tables, migrations, persisted state, derived writes, background jobs,
  or caching layers.
- No user-selectable horizon; no dark-mode or chart-library introduction (the
  text-first pure-SVG pattern continues).

---

## 15. Remaining genuine decisions

1. **PR-event timeline display cap.** Locked at 10 newest events with the
   exact count stated (the M14 count-vs-cap semantics). The numeric cap is a
   presentation constant that may be tuned at implementation review without
   any semantic change.

*(The volume-label alignment decision is resolved — approved and recorded in
§6.4.)*
