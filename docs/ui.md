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
| RecommendationCallout | `shared/RecommendationCallout.tsx` | server | increase/hold/regress/first-exposure/scheme-change |
| PageContainer | `shared/PageContainer.tsx` | server | 1120px column, responsive gutters |
| AppHeader | `shared/AppHeader.tsx` | server | desktop h76 bar; profile pill or sign-in link |
| AppNavLinks | `shared/AppNavLinks.tsx` | client | `usePathname` active state |
| MobileHeader | `shared/MobileHeader.tsx` | server | mobile h64 bar |
| MobileTabBar | `shared/MobileTabBar.tsx` | client | fixed bottom, 4 tabs, safe-area padding |
| Wordmark | `shared/Wordmark.tsx` | server | Sora two-tone "Fit40" link |

### RecommendationCallout contract

The callout is **domain-agnostic and presentation-only**: props are
`kind` (`increase | hold | regress | first-exposure | scheme-change`),
`valueLabel?`, `contextLabel?`, `eyebrowLabel?`. It imports nothing from
domain/application and decides nothing. Bodyweight and duration exercises
render **no** callout — the screen that wires live data simply omits it.
The `ExerciseTargetDto -> RecommendationCallout` mapping belongs in the
Workout/Progressive Overload screen slice, not in this component.

## Application shell and responsive strategy

- The shell lives in `src/app/(app)/layout.tsx` (route group — URLs are
  unchanged). It renders AppHeader (hidden below `md`), MobileHeader
  (hidden at `md`+), page content with bottom clearance for the fixed tab
  bar, and MobileTabBar (`md:hidden`).
- Breakpoint: Tailwind `md` (768px) switches mobile ↔ desktop shell.
- Desktop content column is `max-w-[1120px]` centered (equals the 1440px
  design with 160px gutters); mobile gutters are 20px (`px-5`).
- Touch targets are ≥ 44px everywhere (buttons 52/44, inputs 52, radio cards
  56, chips 48, tab bar 76).
- Tab bar includes `env(safe-area-inset-bottom)` padding for iOS.

## Auth ownership

The `(app)` layout is presentation-only. The group mixes intentionally public
routes (program catalog, program detail, workout detail, exercise catalog)
with private ones; a layout guard would change authorization behavior.
Private pages keep their `requireUser()` calls — they need the `UserDto` for
data and pass route-specific `?next=` deep links. The shell calls
`getCurrentUser()` (request-`cache()`d) only to choose avatar vs. sign-in.

## Follow-up notes (deferred by design)

- **RPE reconciliation.** The locked Active Workout design has no RPE field.
  The existing `SetLoggerForm` RPE behavior must be reconciled in the Active
  Workout screen slice — not silently carried into the redesigned screen.
- **Active Workout bottom bar.** The session page currently shows the shell
  tab bar; the design's bottom action bar (Complete workout) lands with the
  Active Workout slice.
- **Segmented control.** Not present in the locked design; not built.
- **Screen migration.** Profile and Onboarding are migrated to the locked
  design (section cards 01-05, desktop section index, radio cards, chips,
  segmented day/session/unit controls). Dashboard and Program screens are
  migrated to the locked design (see below). Workout detail, Active Workout
  and the Exercises screens still use pre-redesign markup; each migrates in
  its own slice using these primitives.

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
- **C (no source — omitted, not fabricated):** calendar day dots
  (Mon–Sun) — programs schedule per program-week, not per weekday, and no
  completion timestamps are exposed to presentation; session history rows
  (date · sets · volume) and "View history" — no session-history use case
  exists; "Mon · Wed · Fri" cadence; mobile "unlocks after Week N" — the
  domain enforces no week locking (`start-workout-session` allows any
  occurrence), so every scheduled workout stays a working link with a
  truthful "Scheduled" state. When more than 3 workouts are completed, the
  Recent training card links to the program page ("View program progress")
  instead of a nonexistent history screen.

### Dashboard structure

- Header: date eyebrow (UTC, deterministic), "Your training" title,
  Edit profile ghost button, and the sign-out link (quiet text link — not
  in the locked design, kept as the app's only in-session sign-out).
- Two-column desktop layout (main 736px / side 360px within the 1120px
  container); mobile stacks Header → Up next → This week → Current program,
  hiding Recent training and the profile card (locked mobile design).
- "Current program" = most recently joined enrollment (repository orders
  enrollments by joined time ascending; documented simplification while
  the domain has no explicit current-program concept).
- Empty states: no enrollment → `NoProgramCard` (EmptyState + Browse
  programs CTA); program fully completed → `ProgramCompletedCard`.

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
  accent-tint-border card treatment. Workout cards: completed (accent
  check circle, "Completed"), up next (accent-tint card, accent border,
  "Up next"), scheduled (bordered order circle, "Scheduled") — all links.
- Catalog page and cards were restyled onto the same primitives; the
  fabricated "Time: 45 min" card column was removed (no per-program
  duration estimate exists).

