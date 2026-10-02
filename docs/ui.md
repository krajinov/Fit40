# UI Design Foundation

The visual design is locked in `Fit40.pen` (approved Pencil document). This
document describes how the design foundation is implemented in code. Slice 1
delivered tokens, typography, the application shell and shared primitives;
screen content migrates onto them slice by slice.

## Design tokens

Tokens are CSS variables in `src/app/globals.css`, exposed as Tailwind
utilities through `@theme inline`. The shadcn semantic set is remapped to the
Fit40 palette so existing `bg-background`, `text-muted-foreground`,
`bg-primary` markup keeps working; design-native tokens are additive.

| Pencil variable | CSS variable | Value | Utility example |
|---|---|---|---|
| \$bg | `--background` | `#F7F6F2` | `bg-background` |
| \$surface | `--card` / `--popover` | `#FFFFFF` | `bg-card` |
| \$surface-2 | `--surface-2` (also `--secondary`/`--muted`) | `#F0EEE7` | `bg-surface-2` |
| \$ink | `--foreground` (+ `--ink`) | `#1D1F1A` | `text-foreground` |
| \$ink-2 | `--ink-2` (also `--muted-foreground`) | `#575B52` | `text-ink-2` |
| \$ink-3 | `--ink-3` | `#8B8F84` | `text-ink-3` |
| \$border | `--border` | `#E5E2D9` | `border-border` |
| \$border-strong | `--border-strong` (also `--input`) | `#D2CFC4` | `border-border-strong` |
| \$accent | `--primary` | `#2E6B4F` | `bg-primary` |
| \$accent-strong | `--accent-strong` (also `--accent-foreground`) | `#245640` | `text-accent-strong` |
| \$accent-tint | `--accent-tint` (also `--accent`) | `#E9F1EB` | `bg-accent-tint` |
| \$accent-tint-border | `--accent-tint-border` | `#CBDFD2` | `border-accent-tint-border` |
| \$danger | `--destructive` | `#B4452F` | `text-destructive` |
| (regress) | `--amber-tint` / `--amber-border` / `--amber-strong` | `#F6EEE3` / `#E5D3BC` / `#92672F` | `bg-amber-tint` |

### Radii (explicit tokens)

| Token | Value | Utility | Used by |
|---|---|---|---|
| `--radius-control` | 12px | `rounded-control` | buttons, inputs, chips, radio cards |
| `--radius-callout` | 14px | `rounded-callout` | recommendation callouts |
| `--radius-card` | 20px | `rounded-card` | section cards, empty states |
| `--radius-pill` | 999px | `rounded-pill` | badges, avatars, progress bars |

The shadcn computed scale (`--radius: 0.625rem` → `rounded-sm…4xl`) is kept
unchanged for compatibility but new components use the explicit tokens above.

### Dark mode

The locked design is light-only. The `.dark` block remains the stock shadcn
palette, untouched; a Fit40 dark theme is future work. No theme toggle exists.

## Typography

- **Inter** — UI/body text (`--font-sans`, default).
- **Sora** — headings, display, numeric emphasis (`font-display` utility).
- Loaded with `next/font/google` in `src/app/layout.tsx` (self-hosted,
  metric-compatible fallbacks, no layout shift, no client-side handling).
- Scale (observed in the locked design): Sora 36/32/26/24/22/21/20 at
  600–700 for display and values; Inter 16/15/14/13/12 at 400–600 for UI;
  eyebrows are Inter 12/600 with 0.8px tracking.

## Component inventory (`src/components/`)

| Component | File | Boundary | Notes |
|---|---|---|---|
| Button | `ui/button.tsx` | server-safe | base-ui + cva; primary/secondary/outline/ghost/destructive/link; h52/h44 touch targets |
| Input | `ui/input.tsx` | server-safe | base-ui; h52, r12, border-strong; aria-invalid + focus ring |
| Label | `ui/label.tsx` | client (directive) | Inter 14/500 |
| Chip | `shared/Chip.tsx` | server-safe | native checkbox; h48; `has-checked` styling; zero JS |
| SelectableRadioCard | `shared/SelectableRadioCard.tsx` | server-safe | native radio; h56; arrow-key nav for free; zero JS |
| SectionCard | `shared/SectionCard.tsx` | server | r20, p32, optional eyebrow + Sora title |
| Badge | `shared/Badge.tsx` | server | neutral / accent / done pills, h28 |
| Stat | `shared/Stat.tsx` | server | Sora 30/600 value + Inter 13/500 label |
| EmptyState | `shared/EmptyState.tsx` | server | r20, p40, icon + title + body |
| ProgressBar | `shared/ProgressBar.tsx` | server | surface-2 track + accent fill, 10/8px, progressbar ARIA |
| RecommendationCallout | `shared/RecommendationCallout.tsx` | server | M8 states: increase/hold/regress/scheme-change/bodyweight-goal-reached/bodyweight-hold/duration-increase/duration-hold/first-exposure |
| PageContainer | `shared/PageContainer.tsx` | server | 1120px column, responsive gutters |
| AppHeader | `shared/AppHeader.tsx` | server | desktop h76 bar; account slot, else sign-in link |
| AppNavLinks | `shared/AppNavLinks.tsx` | client | `usePathname` active state |
| MobileHeader | `shared/MobileHeader.tsx` | server | mobile h64 bar; account slot, else sign-in link |
| MobileTabBar | `shared/MobileTabBar.tsx` | client | fixed bottom, 4 tabs, safe-area padding |
| Wordmark | `shared/Wordmark.tsx` | server | Sora two-tone "Fit40" link |

### RecommendationCallout contract

The callout is **domain-agnostic and presentation-only**: props are `kind`
(`increase | hold | regress | scheme-change | bodyweight-goal-reached |
bodyweight-hold | duration-increase | duration-hold | first-exposure`),
`valueLabel?`, `deltaLabel?`, `contextLabel?`, `eyebrowLabel?`, `compact?`.
It imports nothing from domain/application and decides nothing. The M8
progression states render through it on the Active Workout logger; the
`ExerciseTargetDto → callout` mapping lives in
`active-workout-logger-views.ts`, never in this component.

### M8 progression presentation (Slice 4)

`progression-labels.ts` (features/sessions) is the single home of
progression UI copy: deterministic `basis`/`reason` → sentence mapping
(exhaustive switches — a new variant fails compilation until given copy),
`formatKg`/`formatSeconds`, direction lines, and truthful "Last time"
context. Raw reason codes never reach users. Locked semantics:

- **Advisory precedence:** current-session logged value > progression
  recommendation > empty. A recommendation never overwrites an entered
  value; it stays visible as context ("Your value stands").
- **Direction is always named in words** (Increase / Keep / Reduce), never
  color alone; regress uses the supportive amber family, never error
  styling.
- **Truthful context:** `ExerciseTargetDto.previousSets` carries the newest
  occurrence's considered sets, so "Last time · 60 kg × 10, 10, 10" renders
  from real data (mixed loads name each set's own load — "Last time ·
  20 kg × 9, 22.5 kg × 9" — never the working minimum as every set's
  load); scheme-change/first-exposure render none, never a
  fabricated line. RPE is not in the projection — recommendations never
  read it.

## Application shell and responsive strategy

- The shell lives in `src/app/(app)/layout.tsx` (route group — URLs are
  unchanged). It renders AppHeader (hidden below `md`), MobileHeader
  (hidden at `md`+), page content with bottom clearance for the fixed tab
  bar, and MobileTabBar (`md:hidden`).
- **Account menu (post-M12 polish).** The layout composes `AccountMenu`
  (`features/auth`) into both headers' `account` slot: desktop renders the
  initial + "Profile" pill, mobile the avatar alone (`aria-label="Account"`),
  and signed-out visitors keep the plain sign-in links. The panel holds
  Profile (`Menu.LinkItem`) and Sign out, which posts to the existing
  `logoutAction` through a native `<form>` — no new mutation path, no client
  session state, and the shared headers still import no feature.
- **Account control before hydration.** The menu is client-controlled, so
  `AccountMenu` renders `AccountMenuFallback` until its own hydration signal
  flips: a native `/profile` link plus a `logoutAction` form in the
  server-rendered HTML, replaced by the interactive menu once the client has
  hydrated. The visible pill/avatar reuses the trigger's own classes and the
  sign-out form sits out of flow, so the right-aligned slot keeps its footprint
  and nothing shifts at hydration; the menu items and the native sign-out
  button all carry the 44px `min-h-11` touch-target floor, and the mobile
  control is a 44px (`size-11`) hit area around the unchanged 32px avatar
  circle, so its target meets the floor without moving the avatar.
- Breakpoint: Tailwind `md` (768px) switches mobile ↔ desktop shell.
- Desktop content column is `max-w-[1120px]` centered (equals the 1440px
  design with 160px gutters); mobile gutters are 20px (`px-5`).
- Touch targets are ≥ 44px everywhere (buttons 52/44, inputs 52, radio cards
  56, chips 48, tab bar 76, history shortcut pills 44).
- Tab bar includes `env(safe-area-inset-bottom)` padding for iOS.

## Auth ownership

The `(app)` layout is presentation-only. The group mixes intentionally public
routes (program catalog, program detail, workout detail, exercise catalog)
with private ones; a layout guard would change authorization behavior.
Private pages keep their `requireUser()` calls — they need the `UserDto` for
data and pass route-specific `?next=` deep links. The shell calls
`getCurrentUser()` (request-`cache()`d) only to choose the account menu vs.
the sign-in links; the menu performs no authorization itself.

## Follow-up notes (deferred by design)

- **RPE (deliberate deviation).** The locked Active Workout design has no RPE
  field; Fit40 restores one deliberately: an optional "RPE (optional)" input
  (1–10) in the set logger, an optional prefilled RPE editor in each
  logged-set row, and an "@ RPE n" suffix on rows where an RPE was captured.
  Leaving it empty keeps the locked look — no RPE is shown or stored.
- **Active Workout bottom bar.** The session page currently shows the shell
  tab bar; the design's bottom action bar (Complete workout) lands with the
  Active Workout slice.
- **Segmented control.** Not present in the locked design; not built.
- **Screen migration.** Profile and Onboarding are migrated to the locked
  design (section cards 01-05, desktop section index, radio cards, chips,
  segmented day/session/unit controls). Dashboard, Program and Workout
  Detail screens are migrated to the locked design (see below). Active
  Workout and the Exercises screens have since migrated in their own
  slices using these primitives.

## Screen notes: Dashboard & Program (Slice 3)

### Data truthfulness (Pencil field classes)

- **A (in DTOs):** next-workout name/coordinates, exercise prescriptions,
  estimated duration, program metadata, enrollment progress
  (completed/total/percentage), completed-scheduled-workout ids, profile
  fields, equipment.
- **B (derived presentation-only):** current program week (first uncompleted
  workout's week), week lifecycle badges (completed / in progress /
  upcoming), per-week completion counts, Start vs. Resume CTA labels
  (session status), date eyebrow, age from birth year.
- **C (no source — omitted, not fabricated):** per-weekday completion dots on
  the authored week cards (sessions carry no per-day completion timestamps, and
  M15's planned-date calendar is a separate, explicitly rendered surface — see
  the M15 section below); session history rows
  (date · sets · volume) and "View history" — no session-history use case
  exists; "Mon · Wed · Fri" cadence; mobile "unlocks after Week N" — the
  domain enforces no week locking (`start-workout-session` allows any
  occurrence), so every scheduled workout stays a working link with a
  truthful "Scheduled" state. When more than 3 workouts are completed, the
  Recent training card links to the program page ("View program progress")
  instead of a nonexistent history screen.

### Dashboard structure

- Header: date eyebrow (UTC, deterministic), "Your training" title and the
  Edit profile ghost button. The dashboard's local sign-out link is gone now
  that the global account menu owns sign-out everywhere; the open landing
  page (`src/app/page.tsx`) still renders `LogoutButton` for signed-in
  visitors.
- Two-column desktop layout (main 736px / side 360px within the 1120px
  container); mobile stacks Header → Up next → This week → Current program,
  hiding Recent training and the profile card (locked mobile design).
- "Current program" = most recently joined enrollment (repository orders
  enrollments by joined time ascending; documented simplification while
  the domain has no explicit current-program concept).
- Empty states: no enrollment → `NoProgramCard` (EmptyState + Browse
  programs CTA); program fully completed → `ProgramCompletedCard`.
- **"Up next" authority (M17):** the dashboard "Up next" card follows the run's
  **first OPEN authored occurrence** — the closure read's
  `openInProgramOrder[0]` — when authoritative closure data is available, so an
  occurrence already recorded as not performed is never offered as "Up next" /
  "Start workout". When the closure read is unavailable the M14 `nextWorkout`
  fallback stands (graceful degradation; no settlement truth is invented). A
  **concluded-but-incomplete** run has no Up next: it renders the factual
  `ConcludedRunCallout` (**"Run closed — {n} completed, {m} recorded as not
  performed"**, no restart control per the M14 dashboard decision) instead of
  the completed card, links to no `/completed`, and suppresses the schedule
  card.

### Program detail structure

- Public page; breadcrumb (Programs / name), header badges (goal accent;
  difficulty/duration/frequency neutral), Sora title, description.
- Visitor-specific enrollment area, three states:
  1. anonymous → `AnonymousVisitorCard` (Sign in with `?next=` deep link
     back to this program + Create account); no enrollment data resolved;
  2. signed-in not enrolled → Join card with `JoinProgramButton`;
  3. enrolled → `EnrolledProgramPanel`: desktop shows eyebrow + Sora
     progress title + Leave (ghost), progress track, and the accent-tint
     Up next row with Start/Resume workout (links to the session page,
     whose panels own the start/resume semantics); mobile shows the
     compact eyebrow/track/count variant and keeps Leave reachable.
- Weekly schedule: one card per week; in-progress weeks get the
  accent-tint-border card treatment, and a **settled-but-incomplete** week
  (every authored workout completed or recorded not performed, at least one
  recorded) shows a neutral **"Settled"** badge — never "Completed" (M17).
  Workout cards: completed (accent
  check circle, "Completed"), up next (accent-tint card, accent border,
  "Up next"), scheduled (bordered order circle, "Scheduled") — all links.
- Catalog page and cards were restyled onto the same primitives; the
  fabricated "Time: 45 min" card column was removed (no per-program
  duration estimate exists).

## Screen notes: Workout Detail (Slice 4)

Migrated `/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]`
onto the locked "Workout — Desktop/Mobile" frames. The page stays public:
anonymous visitors browse the full workout (breadcrumb, Sora title, meta
badges, exercise list, CTA band) with **no** personalized recommendations.

### Progressive overload wiring

- `buildWorkoutDetailView` (features/sessions) resolves the workout via the
  existing use case, then — only for authenticated users — calls
  `GetNextExerciseTargetsUseCase` **once** with one batched request carrying
  every exercise `{exerciseId, prescription}` from the CURRENT scheduled
  workout/template (intentionally different from Active Workout, which will
  use the session snapshot). One target per request position; duplicate ids
  deduplicate inside the use case (no N+1, no aggregate hydration).
- Typed target failures are recoverable personalization: recommendations
  are omitted and the public workout content stays intact (the error
  contract does not require failing the page).
- `workout-target-views.ts` is the `ExerciseTargetDto → view` presentation
  mapper: formats the M8 target blocks (eyebrow / value / delta / reason)
  plus truthful "Last time" context; owns zero progression logic (domain
  decisions arrive complete, copy comes from `progression-labels.ts`).
  regress with a floored `nextLoadKg: null` renders "No added load",
  never a fake "0 kg"; scheme-change shows `NEW TARGET SCHEME` + the
  current scheme, never the historical load.
- `WorkoutTargetBlock` renders the block (accent / surface-2 / amber /
  card treatments, rounded-control), announces eyebrow · value · delta ·
  reason once via `role="img"` + `aria-label` (meaning never depends on
  color), and adds the `Goal reached` badge for bodyweight-goal-reached.
- **Last-time context:** `ExerciseTargetDto.previousSets` (the newest
  occurrence's considered sets) powers "Last time · 60 kg × 10, 10, 10";
  mixed loads name each set's own load ("Last time · 20 kg × 9, 22.5 kg ×
  9") — the working minimum is never presented as every set's load; timed
  work lists seconds ("Last time · 30, 30, 25 sec"), bodyweight work
  lists reps — never a fabricated load.

### Basis → M8 target-block states (approved design)

- increase → accent-tint block `NEXT TARGET {next} kg` + "Increase {n} kg"
- hold → surface-2 block `NEXT TARGET {load} kg` + "Keep current load"
- regress → amber block `NEXT TARGET {lower} kg` + "Reduce {n} kg" /
  `No added load`
- scheme-change → neutral card block `NEW TARGET SCHEME {scheme}`
- bodyweight-goal-reached → accent block `TARGET {maxReps} reps` + goal badge
- bodyweight-hold → accent block `TARGET {maxReps} reps` + rep guidance
- duration-increase → accent block `NEXT TARGET {sec} sec` + "+5 sec"
- duration-hold → surface-2 block `TARGET {sec} sec` + "Keep current duration"
- first-exposure → NO block: one quiet "First time · no history yet" line

### CTA band

Accent-tint "Ready when you are" band; primary CTA targets the session page,
which owns the start/resume/join semantics (no session is created or
mutated on this screen). Label reflects the resolved session state:
anonymous → "Sign in to start" (login deep link to the session page),
not-enrolled → "Join program to start", none → "Start workout",
in-progress → "Resume workout", completed → "View session". The secondary
"View program" CTA is desktop-only (locked mobile frame omits it).

## Screen notes: Active Workout · M8 recommendations (Slice 4)

The session logger surfaces the already-computed M8 recommendation as an
advisory callout beside the input fields (compact variant, M8 "Rec" column
layout). `active-workout-logger-views.ts` owns the prefill precedence;
`session-callout-views.ts` maps the callout, hint, and quiet-line copy; the
callout component stays domain-agnostic.

- **Prefill precedence (locked):** current-session logged value >
  recommendation > empty. Loaded reps work prefills the WEIGHT field from
  the latest logged weight, else `nextLoadKg`. Timed work prefills the
  SECONDS field from the latest logged seconds, else `nextSeconds`. A
  floored regress (`nextLoadKg: null`) prefills nothing, and bodyweight
  work never invents a weight — no prefill, rep-goal callout only.
- **Override behavior:** when a session value won, the prefill keeps it,
  the recommendation callout stays visible as context, and the hint reads
  "You logged 60 kg — your weight stands. The recommendation stays as
  context." No warning, no confirmation, no restoring of the recommendation.
  Recommendation-sourced prefills hint "Advisory prefill — edit freely."
- **Quiet states:** first exposure renders one muted "First time · no
  history yet" line instead of a callout; scheme-change renders the
  informational NEW TARGET SCHEME callout (history is kept, it is simply
  not comparable).
- **RPE:** never part of the recommendation presentation — the history
  projection carries no RPE, and the optional RPE input is unrelated to
  recommendation copy.

## Screen notes: Exercises (Slice 6)

Restyled onto the locked foundation; public access, route URLs, and the
URL-driven filter contract are unchanged.

- **Catalog `/exercises`:** PageContainer shell + Sora page header (same
  pattern as the programs page). Filters render as locked `Chip`s inside a
  single card section: three fieldsets (Equipment / Muscle group /
  Difficulty) that stack on mobile and form a 3-column grid from `md`.
  Filtering behavior is byte-identical to the previous screen — instant
  `router.replace` on the `equipment` / `muscle` / `difficulty` params
  (multi-value), Clear-filters button only when a filter is active.
  `ExerciseFilters` remains the only client component on the screen.
- **Exercise card:** mirrors ProgramCard — accent primary-muscle badge +
  neutral difficulty badge, Sora title link, footer grid with equipment and
  movement pattern. Shows exactly the `ExerciseSummaryDto` fields (name,
  primary muscle, equipment, difficulty, movement pattern); nothing
  invented. 1/2/3-column grid; `aria-live` result count preserved;
  empty results use the shared `EmptyState`.
- **Detail `/exercises/[slug]`:** breadcrumb nav (Exercises / name)
  replaces the duplicated "← Back to catalog" links; name + description
  header, then "Muscles worked" and "At a glance" `SectionCard`s rendered
  as definition lists (deliberately not a badge wall), and a conditional
  "Training guidance" card listing consideration/suitability pairs as
  neutral badges with icon + text (level never conveyed by color alone).
  No image/video field exists on the DTO, so no media is rendered.
- **Shared `Chip`:** gained an optional controlled variant (`checked` +
  `onCheckedChange`) so URL-driven filters can reuse the locked chip; the
  profile's uncontrolled form usage is unchanged.
- `exercise-labels.ts` adds `PHYSICAL_CONSIDERATION_LABELS` and
  `SUITABILITY_LABELS` (label-coverage unit tested). No Domain/Application/
  Infrastructure changes were needed: the DTOs already expose every field
  presented.

## Screen notes: History (M9 Slice 6 — substitution context)

The completed-session detail screen keeps its locked, read-only design; the
only M9 Slice 6 addition is the truthful "Originally: …" context.

- **Performed-first identity:** every entry's title is the PERFORMED
  exercise (the work actually done), linking to that exercise's history
  when the slug resolves.
- **"Originally: …" context:** a substituted occurrence renders one subtle
  `text-xs text-ink-3` line under the performed title naming the AUTHORED
  exercise — same visual convention as the Active Workout card. The line is
  omitted for non-substituted occurrences and when the authored exercise no
  longer resolves in the catalog (never fabricated). Chained substitutions
  still name the original authored exercise.
- **No controls:** history carries no substitution controls — the swap
  panel exists only on the Active Workout screen for in-progress sessions.
- **Order and identity unchanged:** entries render in persisted
  `(sessionId, exerciseOrder)` order; duplicate exercises never collapse;
  set lines keep rendering the persisted snapshot.

Regression coverage: `tests/unit/features/history/completed-session-view.test.ts`
(mapping rules) and the substitution context tests in
`tests/integration/database/training-history-repository.test.ts`
(history/progression key on the performed exercise). Full feature reference:
[`docs/exercise-substitution.md`](exercise-substitution.md).

## Screen notes: Active Workout · M10 skip & move controls

The occurrence card gained a quiet adjustment panel
(`SessionExerciseAdjustPanel`) whose affordances come verbatim from the
domain's `adjustmentEligibility` DTO projection — never re-derived from
position, skip state, or logged sets:

- **Skip path:** "Skip exercise" (open) / "Undo skip" (skipped) as a quiet
  pill posting to the skip/unskip actions; a skipped card renders a neutral
  `Skipped` badge + truthful hint instead of a logger. An occurrence with
  logged sets shows only the muted truthful copy ("Delete your logged sets
  to skip this exercise.").
- **Move path (adjacent):** "Move up"/"Move down" quiet pills render per the
  domain's `canMoveUp`/`canMoveDown`. A skipped occurrence still moves; a
  logged-sets occurrence still moves (logged sets freeze only the skip
  decision). A combined pending flag across both forms prevents duplicate
  submits; there is no client-side optimistic reorder — the canonical DTO
  order renders as received after server revalidation.

Completed/read-only sessions render no mutation controls at all. Full
semantics: [`docs/session-adjustments.md`](session-adjustments.md).

## Screen notes: History · M10 skipped-occurrence truth

Completed-session detail keeps its locked read-only design; the M10 addition
is truthful skip representation:

- A skipped occurrence renders a de-emphasized card (`opacity-80`) with a
  neutral `Skipped` badge instead of set rows — no fabricated metrics, no
  "No sets were logged." line, and no link to exercise performance history
  (the persisted flag is authoritative, never inferred from zero sets).
- A substituted+skipped occurrence keeps the performed-first title plus the
  subtle "Originally: …" line — truthful identity without implying
  performance.
- A zero-set non-skipped occurrence remains distinct: "No sets were logged."
  + the exercise link, never labeled skipped.
- Entries render in the final persisted session order (post-reorder), never
  the template order.

Regression coverage: `tests/unit/features/history/completed-session-view.test.ts`,
`tests/unit/features/history/completed-session-entry-list.test.ts`, and the
M10 integration tests in `tests/integration/database/training-history-repository.test.ts`.
Full feature reference:
[`docs/session-adjustments.md`](session-adjustments.md).


## Screen notes: History · recently trained exercises (post-M12 polish)

The history screen gained one derived-presentation shelf between the totals
card and the completed-workout list. It is derived only — no new read of the
session side:

- **Selection is pure.** `selectRecentlyTrainedExerciseIds` walks the page
  already loaded for the screen and collects distinct PERFORMED exercises in
  newest-occurrence-first order, skipping occurrences the user explicitly
  skipped (the persisted flag stays authoritative). A skipped occurrence never
  hides the exercise: an older performed occurrence still supplies it.
- **Capped before the lookup.** At most `MAX_HISTORY_EXERCISE_SHORTCUTS` (10)
  ids reach the catalog, so a long page never widens the query beyond what is
  rendered.
- **One batched lookup.** `buildHistoryView` resolves the selection through
  `getExercisesByIdsUseCase` (composed in `features/history/services.ts`) — no
  per-id query, no catalog-list over-fetch.
- **Honest absence.** An id the catalog no longer resolves is omitted rather
  than replaced by a placeholder, and a lookup failure is surfaced like the
  other read failures instead of being hidden behind an empty row.
- **Nothing when empty.** `HistoryExerciseShortcuts` renders no section at all
  for an empty selection; the row is navigation only (no controls).

Regression coverage: `tests/unit/features/history/history-view.test.ts`
(selection, ordering, cap, unresolved ids, batched lookup, failure
propagation) and
`tests/unit/features/history/history-exercise-shortcuts.test.ts`.

## Personal Records (M12)

- Exercise History renders a Personal Bests summary from `PersonalBestDto`:
  only returned metrics render, the earliest equal owner keeps the session
  link, and 0 kg displays as a real value.
- Completed-session detail badges individual set rows from
  `SessionRecordEventDto`, matched strictly by `(exerciseOrder, setNumber)`;
  presentation never compares values and never infers occurrence-level PRs.
- The same screen renders a one-line legend explaining the badge ("PR marks
  the set that established a personal record for that exercise at the time.")
  and only when a badge is actually on screen: `hasPersonalRecords` is counted
  from the rendered set rows, so a resolved event attached to nothing visible
  (a skipped occurrence) never triggers it. The badge keeps its `sr-only`
  "Personal record" text and gained no `title` attribute, so assistive tech is
  not told the same thing twice.
- Deferred in UI: completion-moment PR banner/toast, exercise-history PR
  timeline markers, dashboard widgets, and session-list indicators.
  Canonical reference: [Personal Records](personal-records.md).
## Training dashboard · weekly insights (M13)

The dashboard gained a user-global **"This week"** section built from
completed training history, an eight-week activity strip, and a recent
personal bests card. The insights render with or without an enrolled program
and never read program schedules.

### Calendar-week insights

- A **training week** is Monday 00:00:00.000 UTC (inclusive) to the next
  Monday 00:00:00.000 UTC (exclusive). Windows are plain epoch-millisecond
  arithmetic in `src/domain/services/training-week.ts`, so every completion
  instant belongs to exactly one week and a window is deterministic for a
  given instant regardless of server, database, or viewer timezone.
- **UTC is deliberate and deterministic**: Fit40 currently has no
  user-timezone preference, so a hidden local-time rule would make week
  boundaries shift silently between environments. The strip states it
  plainly: "Weeks run Monday–Sunday (UTC)."
- The insights are **user-global**: the activity read scopes only to the
  user's completed sessions (ownership + `completed_at`), with no enrollment
  filter — detached (left-program) history counts, and no current program is
  required.

### Weekly metrics

Three stats render under the "This week" heading:

- **Workouts** — completed sessions whose `completedAt` falls in the current
  UTC week. User-global; each completed session counts once, whatever
  program it belonged to (detached history included). An in-progress session
  never counts.
- **Sets** — the persisted logged sets belonging to those completed sessions
  in the current UTC week, summed. A plain count of the window's sessions'
  `set_logs` rows; it never re-derives volume, intensity, or duration.
- **Current PBs set** — CURRENT, still-standing all-time personal bests whose
  winning performance was established during the current UTC week. This is
  NOT the number of historical PR events achieved during the week: a best
  set this week and surpassed later is no longer current and is not counted.
  Historical PR events remain the M12 per-session PR badges on completed-session
  detail; this dashboard never reconstructs them.

### Previous-week comparison

- The previous week is always a concrete UTC calendar window — the week
  immediately before the current one, same Monday-to-Monday shape.
- Absence of completed sessions means zero. The data model cannot distinguish
  "did not train" from "was not tracked", so there is deliberately **no
  "untracked previous week" state**.
- Deltas are ordinary numeric `current − previous` comparisons (negative
  when the current week is behind). Presentation only chooses wording —
  "No training in the last two weeks." / "No training last week." / "Same as
  last week." / signed deltas — and never re-derives the numbers.

### Eight-week activity strip

- Completed-workout counts for **eight UTC calendar weeks**, oldest →
  newest, current week last and highlighted.
- **Factual activity only**: each bar is a count, with an sr-only label per
  week ("Week of Feb 16: 2 workouts (this week)") and a visible floor so a
  zero week reads as "no training" rather than a gap.
- **No streak or gamification semantics**: consecutive-week chains, XP,
  badges, and "best streak" claims are out of scope by design.

### Personal bests card

- Renders up to **five** (`RECENT_PERSONAL_BESTS_LIMIT`) recently
  established current personal bests, newest winners first.
- Eligibility: only PBs whose **current winning performance** lies in the
  eight-week lookback (the oldest week's Monday 00:00 UTC up to the request
  clock). Ranking runs over ALL eligible history first; the window is then a
  predicate on the already-chosen winner — never a "best value within the
  window" ranking (`findCurrentPersonalBestsSetBetween`).
- Each row links to the owning completed session (M12 earliest-equal owner).
- **Surpassed historical PR events are not reconstructed** for this
  dashboard: a record that no longer stands does not appear, and the
  "Current PBs set" stat comes from the record read, not from rendered rows.
- Catalog identity is resolved through one batched lookup, only for rows
  that will render; an exercise the catalog can no longer resolve is omitted
  rather than placeholder-named.

### Calendar week vs program week

Two different "week" concepts share the dashboard and must not blur:

- **"This week"** (weekly insights card) = UTC calendar-week historical
  activity: what you actually completed since Monday 00:00:00 UTC.
- **"Program week"** (weekly progress card eyebrow + `aria-label="Program
  week"`) = ordinal program/enrollment progress ("Week 3", "3 of 8
  workouts completed").

Program workouts are ordinal positions within the program, not
calendar-scheduled dates — nothing in M13 implies a workout was "due" on a
particular calendar day, and the calendar day-dot treatment from the locked
design stays omitted for that reason.

### Mobile behavior

Final implemented behavior — a product decision that **supersedes the
earlier M13 plan statement** that would have hidden Recent Training on
mobile:

- **Recent Training remains visible on mobile.** It is the dashboard's
  existing mobile entry point to `/history`, and `MobileTabBar` has no
  History tab (Home / Programs / Exercises / Profile only). Hiding it would
  strand mobile users; a History tab can revisit this decision later.
- **Profile Summary remains hidden on mobile** (`hidden md:flex`).
- **M13 insights remain available without a current program**: "This week",
  "Personal bests", and "Recent training" render right after the no-program
  state, so the user-global view never depends on an enrollment.

### Truthfulness · deliberate non-goals

Why the dashboard does **not** show:

- **Total training time** — `completedAt − startedAt` is wall-clock elapsed
  time and includes idle gaps; presenting it as training duration would
  fabricate precision the data does not have.
- **Planned/expected workouts this calendar week** — scheduled workouts are
  ordinal program positions and there is no enrollment-to-calendar anchor,
  so "you should have trained 3× this week" would be an invented schedule.

Preserved M13 non-goals: no AI coaching, no readiness/recovery score, no
e1RM, no calorie estimate, no streaks/XP/gamification, no persisted
analytics snapshots, no new scheduling semantics, and no historical
dashboard PR-event reconstruction.

Degradation contract: a failed read renders a typed "unavailable" message
and is logged — never zeros, which would claim an authoritative zero week;
an empty but successful read renders authoritative zeros and honest empty
copy.

Regression coverage:
`tests/unit/domain/services/training-week.test.ts`,
`tests/unit/application/use-cases/get-training-weekly-insights.test.ts`,
`tests/unit/application/dto/training-insights.test.ts`,
`tests/unit/features/dashboard/weekly-insights-view.test.ts`,
`tests/unit/features/dashboard/dashboard-view.test.ts`,
`tests/unit/features/dashboard/dashboard-insights-cards.test.ts`, and the
M13 integration suites in
`tests/integration/database/training-history-repository.test.ts` and
`tests/integration/database/personal-record-repository.test.ts`.

## Program completion & restart (M14)

- **Completion route** `/programs/[programSlug]/completed`: done badge,
  program identity, "Completed workouts / Completed on / Exercises trained"
  facts, and a "Personal records during this program" section whose caption
  states the exact historical count ("… during this run — historical
  records, not current personal bests") plus the truthful cap note ("Showing
  the 5 most recent.") when the display list is capped; zero events renders
  an honest empty state. Actions: primary "Start program again" (client
  leaf; slug-only form, pending "Restarting…", typed errors via
  `role="alert"`) and secondary "Choose another program" → `/programs`.
  Not enrolled / incomplete / post-restart visits redirect to program
  detail; unknown slug is a 404.
- **Program detail — completed enrollment**: the completed callout keeps its
  message and Completed pill and gains "View completion summary" plus the
  shared restart button; Leave stays in both placements (desktop header and
  mobile). Incomplete enrollments are untouched (up-next row, progress,
  Leave) and never see completion or restart controls.
- **Session Completed**: a factual "Program complete" callout ("You've
  completed every scheduled workout in {Program}.") with "View completion
  summary" renders only when the server-derived enrollment view says the run
  is complete — never on the active/in-progress logger, never on workout
  detail, and an unavailable optional read degrades to no callout rather
  than a false claim.
- **Dashboard**: the completed card's primary action is now "View summary" →
  the completion route; "Browse programs" remains; there is deliberately
  **no restart control on the dashboard** and no new dashboard read.
- Copy bans held across all four surfaces: no XP/achievement/calories/
  e1RM/adherence/training-time, no confetti, no current-PB claims ("M13
  Current PBs set this week" language never appears here); interactive
  targets keep the ≥ 44px contract (52px primary/secondary).
- Regression coverage:
  `tests/unit/features/enrollment/{completion-view,program-completion-summary,enrolled-program-panel,restart-action}.test.ts`,
  `tests/unit/features/sessions/{session-completed-callout,active-workout-view,active-workout-screen}.test.ts`,
  `tests/unit/features/dashboard/program-completed-card.test.ts`, and
  `tests/unit/app/program-completed-page.test.ts`.
- Canonical reference: [Program Completion & Restart](program-completion.md).

## Workout scheduling & training calendar (M15)

- **Dashboard schedule card** (under "Up next", rendered only while the run is
  not complete): unconfigured runs get the setup state — "Training schedule",
  "Choose your training days to put this program on your calendar.", "No
  training days set yet.", the setup UTC helper line, and "Set training days"
  linking to `/programs/[slug]` (where the form lives). Configured runs get
  **TODAY** (accent badge + "Week N · Workout N" eyebrow + workout name;
  "Start workout" / "Resume workout" via the existing session route, or a
  `done` badge "Completed today" with no Start), **NEXT WORKOUT** (neutral
  badge; rendered only when nothing is actionable today; "Planned for Sep 30"
  from the component-based date formatter; secondary "View details" only, so it
  never competes with an actionable Today), and a neutral past-due line ("N
  planned workout(s) behind schedule"). A failed read renders nothing — it
  never masquerades as "not configured". Copy bans hold: never "failed",
  "missed" or "skipped"; M13 insights, recent training and the M14 completed
  card are untouched, and completed runs never show this card.
- **Program detail schedule section** (anchored `id="training-schedule"`,
  between the enrollment panel and the unchanged authored weeks):
  unconfigured = heading + copy + setup UTC helper + the **training-days
  form** (seven labelled weekday chips — native checkboxes, ≥48px, keyboard
  operable, nothing pre-checked in either mode — and "Set training days").
  Configured = past-due summary (count + "Earliest: …"), the **seven-slot
  Monday–Sunday week** as an `<ol>` (vertical list on mobile, 7-column grid
  from `md`, never horizontally scrolling): each slot shows the day label, the
  date label ("Sep 23" — never the raw ISO string), today marked by the word
  "Today" **and** `aria-current="date"`, empty days as neutral "No workout
  planned", statuses as text badges (Planned / In progress / Completed / Past
  due / Recorded as not performed), an in-progress "Resume" link to the session route, and a collapsed
  **"Move"** disclosure (native `type="date"` input defaulting to the canonical
  date, label "New date for {workout}", submit "Move workout") on
  never-started cells only — `planned` and `past-due` expose Move, `completed`
  and `in-progress` never do. Settlement affordances (M17 — the "Didn't train
  this" record form and the "Undo" form) are documented under
  [Run settlement & run closure](#run-settlement--run-closure-m17) below. A collapsed **"Change training days"**
  disclosure hosts the same fresh-selection form with the replacement copy
  ("Choose a new weekly pattern. Saving replaces the dates of future
  workouts; completed workouts stay in history and in-progress workouts keep
  their current date.").
- **UTC disclosure (exactly two lines, both on program detail):** the setup
  helper "Weeks run Monday–Sunday on the app's UTC calendar — the same
  calendar your weekly insights use." and the configured caption "Weeks run
  Monday–Sunday (UTC)." No other schedule label, date, error or form mentions
  UTC; the dashboard carries none.
- **Accessibility & trust:** errors use `role="alert"`; pending submits are
  disabled ("Saving…" / "Moving…"); interactive targets stay ≥44px; forms
  carry only `weekday` values or one date field plus server-injected public
  coordinates — no `EnrollmentId`, `ScheduledWorkoutId`, `SessionId` or `userId`
  appears in the DOM, forms or URLs; today is distinguished by text and
  semantics, not colour alone.
- **Completed runs:** the page renders no scheduling section at all, and the
  M14 completion/restart/leave surface stays the only lifecycle state.
- Regression coverage:
  `tests/unit/features/schedule/{schedule-week-view,program-schedule-section,training-days-form,move-planned-workout-form,configure-training-days-action,reschedule-planned-workout-action,schedule-actions-schema}.test.ts`,
  `tests/unit/features/dashboard/{training-schedule-card,dashboard-view}.test.ts`,
  and `tests/unit/app/{dashboard-page,program-detail-page}.test.ts`.
- Canonical reference: [Workout Scheduling & Training Calendar](scheduling.md).

## Screen notes: Plan follow-through (M16)

- **Placement:** program detail, immediately **below the M15 schedule section**
  and above the authored "Weekly schedule" list (`PlanFollowThroughSection`, a
  Server Component). No route, nav item or dashboard change; placement on the
  page is the page's decision, and M16 adds no client code, no browser clock and
  no fetch.
- **Framing (locked):** title **“This plan so far”** with the hint **“last 8
  weeks”**; one `<ul aria-label="Plan follow-through by week">` of rows: week
  range label (component-based from the window's own bounds — `Sep 21–27`
  inside a month, `Sep 28–Oct 4` across one, never a raw instant), `"N of M
  done"` straight from the DTO, optional `"n started"`, `"n past due"` and
  `"n not performed"` (only
  when non-zero), and **“This week”** with `aria-current="date"` on the open
  week containing `today`. The current week is distinguished by words and
  semantics, never colour, and no row or total is ever framed as unfinished or
  failed.
- **Totals line:** factual fragments from the DTO totals —
  `7 planned · 5 done · 1 completed early · 1 completed late · 1 started · 3
  past due · 1 not performed` — with the two core counts always shown (a real
  zero stays a zero). When `notPerformedUnplaced` is nonzero, one pointer line
  renders: **“1 recorded as not performed without a calendar date — see
  Training schedule”** (plural: “2 recorded…”), linking to the M15 calendar
  where the unplaced list and Undo live; the count itself never reaches a week
  or total. The configured report whose weeks are all outside the horizon
  renders the
  honest **“No planned dates in the last 8 weeks.”** instead of six zero counts.
- **Disclosure (exactly one, M16's only new caption):** “This describes the
  dates currently on your calendar. Changing your training days replaces them.”
  No UTC wording appears in this section — M15's two UTC lines remain the only
  UTC text in this UI (see `docs/scheduling.md`), and there is no
  consistency/history disclosure here.
- **States:** `configured: false`, `ok(null)`, a completed run, and a failed
  read all render **nothing** (no empty card, no zero weeks, no setup CTA);
  configuring training days stays exclusively M15's surface. A failed read is
  logged at the page and degrades this section only — it is never rendered as
  `configured: false` and never fabricates weeks.
- **Copy bans:** never `missed`, `failed`, `skipped`, `streak`, `adherence`,
  `score`, `goal`, `on track`/`off track`, or a percentage; `past due`,
  `completed early`, `completed late` and `recorded as not performed` are the
  approved factual terms. The
  page provides no interactive control here (no button, link or disclosure), so
  no target-size or focus handling applies — the record and Undo forms live on
  the M15 calendar, never in this report.
- Regression coverage:
  `tests/unit/features/schedule/{follow-through-view,plan-follow-through-section}.test.ts`,
  `tests/unit/app/program-detail-page.test.ts`,
  `tests/unit/architecture/follow-through.test.ts`, and the real-PostgreSQL
  `tests/integration/database/follow-through-round-trip.test.ts`.
- Canonical reference: [Plan Follow-Through](follow-through.md).


## Run settlement & run closure (M17)

- **Calendar record affordance (M15 slots):** `planned` / `past-due` cells
  keep the Move disclosure and gain the **"Didn't train this"** submit
  (`RecordNotPerformedForm`, pending "Saving…"); `in-progress` cells offer
  "Didn't train this" instead of Move, with the honesty sentence **"Recording
  removes the empty workout you have in progress."** on motion-sensitive
  inputs; `completed` cells gain nothing.
- **Calendar undo affordance:** a `not-performed` cell shows the status text
  **"Recorded as not performed"** and the **"Undo"** form (subtext **"It goes
  back to not started."**) only — no Start, no Move. Undo is the safety
  mechanism: there is **no confirmation dialog anywhere**, and there is **no
  bulk record/undo action** (grep-locked in architecture tests).
- **Unplaced list** (below the calendar, `UnplacedNotPerformedList`):
  heading/aria-label **"Recorded as not performed"**, body **"These workouts
  are recorded as not performed and have no calendar date right now."**, each
  row = authored week/order labels + a per-row **Undo** — never an invented
  date.
- **Workout detail CTA band** (`WorkoutStartPanel`, `ctaState: 'not-performed'`):
  heading **"Recorded as not performed"**, body **"It goes back to not
  started."**, an **Undo** form; Start is suppressed for this state. The
  scheduled workout card shows the same status text.
- **Session route recorded state** (`SessionRecordedPanel`, a direct/bookmarked
  session URL): when the occurrence is recorded and no session exists, the
  session screen renders the SAME recorded CTA band (heading **"Recorded as not
  performed"**, **"It goes back to not started."**, an **Undo** form) and offers
  **no** Start — recorded state dominates the not-started presentation, so a
  bookmarked URL can never show an impossible "Start workout". The recorded
  fact is read from `GetWorkoutSessionUseCase`; after **Undo** the next
  authoritative read restores the normal not-started / open state and Start may
  become available again.
- **Concluded run panel** (`ConcludedRunCallout` inside `EnrolledProgramPanel`):
  **"Run closed — {n} completed, {m} recorded as not performed"** (both counts
  always rendered), shown when the run is concluded; the **restart**
  button renders iff `restartAvailable`, and the callout never links to
  `/completed` — completion semantics stay unreachable for concluded-but-
  incomplete runs.
- **Authored card identity (corrected):** a recorded occurrence is shown as
  **"Recorded as not performed"** with **Undo** (never a Start, never "Up
  next") on its authored week card whether it currently holds a planned row OR
  is **rowless** — the recorded identity is built from both the M15
  `not-performed` items and the rowless `unplacedNotPerformedWorkouts`
  projection, so a rowless record needs no fabricated planned date to suppress
  Start.
- **Up-next authority:** the program panel and the **dashboard** follow the run's
  **first OPEN authored occurrence** from the closure DTO's `openInProgramOrder`
  when the closure read is available — an occurrence recorded as not performed
  is settled, so it is never displayed as "Up next" or offered a Start. The M14
  `nextWorkout` is used only as the fallback when the closure read is
  unavailable (graceful degradation), and React never recomputes openness.
- **Week status authority (M17):** an authored week is **Completed** only when
  EVERY authored occurrence in it has a completed session — a
  not-performed record never counts as one. A week whose authored occurrences
  are all settled but not all completed (a completion plus a record, or an
  all-recorded week) is **Settled**; the current week holding the authoritative
  first OPEN occurrence stays **In progress**; a concluded-but-incomplete run
  paints no week "Completed". Completion is never inferred from the first open
  occurrence, from `nextOccurrence === null`, from run conclusion, or from a
  record (pure resolver `resolveProgramWeekStatus`).
- **Restart refusal copy:** the typed `PROGRAM_NOT_COMPLETE` error renders as
  **"This run hasn't finished yet."** — restartability (complete OR
  concluded), never phrased as completion.
- **Follow-through pointer:** the M16 report gains only the `"n not performed"`
  week/totals fragment and the unplaced pointer line (see the M16 section);
  no settlement control ever appears there.
- **Errors:** every record/undo/start/restart failure surfaces inline through
  `ScheduleActionError` / the restart form with `role="alert"` and the typed
  use-case copy — no toast system, and contract violations log at the boundary
  rather than rendering raw internals.
- **Accessibility & trust:** forms carry only server-injected public
  coordinates (no `EnrollmentId` / `ScheduledWorkoutId` / `SessionId` /
  `userId` in DOM or URL); interactive targets stay ≥44px; pending submits are
  disabled; status and settlement are always text + semantics, never colour
  alone.
- Regression coverage:
  `tests/unit/features/schedule/{schedule-week-view,program-schedule-section,record-not-performed-action,undo-not-performed-action}.test.ts`,
  `tests/unit/features/sessions/{workout-cta-state,workout-start-panel}.test.ts`,
  `tests/unit/features/enrollment/{program-panel-state,enrolled-program-panel,restart-action}.test.ts`,
  `tests/unit/features/schedule/follow-through-view.test.ts`, and
  `tests/unit/architecture/{settlement-presentation,session-creation-authority}.test.ts`.
- Canonical reference: [Run Closure & Not-Performed Settlement](run-closure.md).
