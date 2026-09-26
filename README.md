# Fit40

Fit40 is a fitness and training platform for adults aged 40+. It turns a strength
program into a guided, session-by-session experience: pick a program, enroll,
work through its scheduled weeks and workouts, log every set — and get
advisory progressive-overload recommendations based on your own performance
history.

## Features

- **Email + password authentication** — argon2id password hashing, opaque
  database-backed sessions (only SHA-256 token hashes are stored), `HttpOnly`
  session cookie.
- **Program catalog & enrollment** — browse training programs and enroll to
  track progress through their weeks.
- **Guided workout sessions** — start or resume a scheduled workout, log sets
  (weight, reps, RPE), and complete the session.
- **Exercise substitution** — swap the performed exercise of any
  not-yet-logged occurrence for a structurally similar catalog alternative,
  while per-exercise history and progression stay keyed on the exercise you
  actually performed.
- **Progressive-overload recommendations** — per-exercise "next target"
  states with truthful last-time context, derived from your completed
  performance history.
- **Exercise catalog** — filterable by equipment and personal limitations, with
  suitable alternatives.
- **Profile & onboarding** — age, weight, goals, equipment, and limitations
  feed exercise suitability.
- **Dashboard** — next scheduled workout preview, current program progress,
  and user-global weekly insights on a Monday–Sunday (UTC) calendar week:
  "This week" workouts, sets, and still-standing current PBs with a
  previous-week comparison, an eight-week activity strip, and recently
  established personal bests. Insights work with or without an enrolled
  program (see [`docs/ui.md`](docs/ui.md) for the full contract).
- **Training history** — completed sessions across programs with per-exercise
  detail, plus user-global exercise history (`/history/exercises/[slug]`)
  showing every completed occurrence and a working-load trend.
- **Program completion & restart** — finishing every scheduled workout
  unlocks a truthful completion summary (`/programs/[slug]/completed`):
  workout tally, derived completion date, distinct exercises trained, and
  the run's historical personal-record events. "Start program again"
  restarts the run through one atomic write while training history and
  personal bests survive (see
  [`docs/program-completion.md`](docs/program-completion.md)).
- **Workout scheduling & training calendar** — pick training days for a run
  and get a deterministic calendar of planned workout dates: Today / Next /
  past-due on the dashboard, a current-week Monday–Sunday calendar on program
  detail, Set/Change training days, and a manual Move for never-started
  workouts. Planning is calendar intent only — completion, history and
  progression still read completed sessions (see
  [`docs/scheduling.md`](docs/scheduling.md)).

## Progressive Overload

Recommendations are designed to assist, never to take over:

- **Snapshot prescriptions.** A workout session snapshots the prescribed
  sets/reps/load when it starts. You train what was prescribed, not a live view.
- **Advisory only.** Suggestions (e.g. "NEXT TARGET 62.5 kg · Increase
  2.5 kg — completed all prescribed sets at the top of the rep range")
  appear as target blocks and logger callouts. They never mutate the
  program or the prescription.
- **You have the final say.** The weight or duration you actually log in
  the current session is what gets recorded — it takes precedence over
  any recommendation, which stays visible as context ("Your value stands").
- **Every progression state is surfaced.** Loaded work increases, holds,
  and regresses (supportive amber, never error styling). Bodyweight work
  shows the authored rep target — "Goal reached" or rep guidance, never
  an invented load or substitution. Timed work shows the target duration
  ("35 sec · Increase duration by 5 sec" / "Keep current duration").
  First exposure stays lightweight ("First time · no history yet"), and a
  changed prescription shows the new scheme without implying history was
  deleted. Every state names its direction in words, never color alone.

Data model note: program progress is **enrollment-scoped**, while completed
exercise performance history is **user-global** — an exercise performed in any
program informs its next recommendation.

## Tech Stack

| Area           | Choice                                        |
| -------------- | --------------------------------------------- |
| Framework      | Next.js 16 (App Router), React 19             |
| Language       | TypeScript (strict)                           |
| UI             | Tailwind CSS 4, shadcn/ui, Base UI            |
| Persistence    | PostgreSQL + Drizzle ORM                      |
| Validation     | Zod (server-side authoritative)               |
| Auth           | Custom credentials + database sessions        |
| Testing        | Vitest (unit + integration)                   |
| Package manager| pnpm (pinned via `packageManager` field)      |

## Architecture

Layered architecture with dependencies pointing inward:

```
Presentation   src/app · src/features · src/components
    ↓
Application    src/application  (use cases, ports, DTOs)
    ↓
Domain         src/domain       (entities, value objects, services)
```

**Infrastructure** (`src/infrastructure`) implements the ports the Application
layer defines: repositories map Drizzle rows to domain objects, so components
never see database types. The domain layer is pure TypeScript with zero
framework imports.

- Server Components are preferred by default; Client Components exist only
  where interactivity requires them.
- Mutations go through Server Actions that validate input with Zod —
  server-side validation is authoritative.
- Expected failures return a typed `Result`; unexpected errors hit error
  boundaries.

Full details: [`docs/architecture.md`](docs/architecture.md) and
[`AGENTS.md`](AGENTS.md).

## Getting Started

**Prerequisites:** Node.js, pnpm 11 (the exact version is pinned in
`package.json`), and a local PostgreSQL server.

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create the databases (app + integration tests):

   ```bash
   createdb fit40
   createdb fit40_test
   ```

3. Configure the environment:

   ```bash
   cp .env.example .env
   # set DATABASE_URL, e.g. postgresql://postgres:postgres@localhost:5432/fit40
   ```

4. Apply migrations and (optionally) seed reference data:

   ```bash
   pnpm db:migrate
   pnpm db:seed   # idempotent: exercises + training programs
   ```

5. Start the dev server:

   ```bash
   pnpm dev   # http://localhost:3000
   ```

Register an account at `/register`, then enroll in a program from `/programs`.

## Environment Variables

Validated at startup via Zod (`src/lib/env.ts`); see `.env.example`.

| Variable            | Required | Description                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`      | Yes      | PostgreSQL connection string, e.g. `postgresql://postgres:postgres@localhost:5432/fit40` |
| `NODE_ENV`          | No       | `development` \| `test` \| `production` (default: `development`)             |
| `TEST_DATABASE_URL` | No       | Integration-test database URL; falls back to `postgresql://postgres@127.0.0.1:5432/fit40_test` |

No authentication-related environment variables are required: sessions are
database-backed with opaque random tokens, so there is no `AUTH_SECRET`. (If
OAuth is adopted later, provider-specific variables may be introduced.)


## Database

PostgreSQL, accessed through Drizzle ORM.

- **Migrations** — generated by drizzle-kit into
  `src/infrastructure/database/migrations` (never edited by hand). `pnpm
  db:generate` creates them from schema changes; `pnpm db:migrate` applies
  them.
- **Seed** — `pnpm db:seed` inserts reference data (exercises, training
  programs, scheduled workouts) with insert-if-missing semantics, so re-running
  is safe.
- **Access** — all persistence flows through repositories that map Drizzle rows
  to domain objects. See [`docs/database.md`](docs/database.md).

## Testing

```bash
pnpm test              # unit tests — pure domain/use-case logic, no database
pnpm test:watch        # unit tests in watch mode
pnpm test:integration  # integration tests against a real PostgreSQL database
```

- Unit tests need no database. Integration tests must **never** use your
  development database: they truncate every table.
- Integration tests target `TEST_DATABASE_URL`, falling back to
  `postgresql://postgres@127.0.0.1:5432/fit40_test`. As a safety guard, the
  target database name must end in `_test` — a URL pointing anywhere else is
  rejected before any destructive statement runs. Migrations are applied
  automatically by the suite's global setup.

## Main Application Areas

| Area                  | Routes (App Router)                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Landing / auth        | `/`, `/login`, `/register`                                                                             |
| Dashboard             | `/dashboard`                                                                                           |
| Profile & onboarding  | `/profile`, `/onboarding`                                                                              |
| Programs & enrollment | `/programs`, `/programs/[programSlug]`                                                                 |
| Workout detail        | `/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]`                                   |
| Active session        | `/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session`                            |
| Exercise catalog      | `/exercises`, `/exercises/[slug]`                                                                      |
| Training history      | `/history`, `/history/sessions/[sessionId]`, `/history/exercises/[slug]`                                |

Feature modules under `src/features/`: `auth`, `dashboard`, `enrollment`,
`exercises`, `history`, `profile`, `programs`, `sessions`.

## Design / Engineering Principles

- **Layered boundaries.** Presentation → Application → Domain; dependencies
  point inward only. Infrastructure implements Application ports and maps
  persistence to Domain — the schema is never the domain model.
- **Pure domain logic.** Business rules live in `src/domain/services` and
  `src/application/use-cases` — never in React components, Server Actions, or
  queries.
- **Server Components by default.** Client Components are small, leaf-level,
  and only where interactivity demands.
- **Authoritative server-side validation.** Zod schemas guard every
  Server Action boundary; client checks are UX only.
- **Typed outcomes.** Expected failures return `Result` values with typed error
  codes; unexpected errors throw into error boundaries.
- **Test behavior, not implementation.** Every domain service and use case has
  unit tests; repository behavior is covered by integration tests against real
  PostgreSQL.

## Project Status

Early development (v0.1): authentication, profiles, program enrollment, guided
workout sessions, progressive-overload recommendations, training history with
Personal Records, the dashboard's weekly training insights, and an
enrollment-scoped workout training calendar (choose training days, get a
deterministic planned-date schedule with Set/Change training days and a manual
Move) are implemented. Program generation via AI, richer progress charts, OAuth, and
email verification are listed as planned work in the docs. No deployment or
Docker setup is included yet.

See [`docs/`](docs/) for architecture, conventions, database, testing, UI,
and Personal Records documentation, and [`AGENTS.md`](AGENTS.md) for the
engineering rules AI agents follow in this repository.