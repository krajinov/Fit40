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
- **Progressive-overload recommendations** — per-exercise "recommended today"
  chips derived from your completed performance history.
- **Exercise catalog** — filterable by equipment and personal limitations, with
  suitable alternatives.
- **Profile & onboarding** — age, weight, goals, equipment, and limitations
  feed exercise suitability.
- **Dashboard** — next scheduled workout preview and current program progress.
- **Training history** — completed sessions across programs with per-exercise
  detail, plus user-global exercise history (`/history/exercises/[slug]`)
  showing every completed occurrence and a working-load trend.

## Progressive Overload

Recommendations are designed to assist, never to take over:

- **Snapshot prescriptions.** A workout session snapshots the prescribed
  sets/reps/load when it starts. You train what was prescribed, not a live view.
- **Advisory only.** Suggestions (e.g. "increase to 52.5 kg") appear as
  recommendation chips. They never mutate the program or the prescription.
- **You have the final say.** The weight you actually log in the current
  session is what gets recorded — it takes precedence over the recommendation.
- **Bodyweight & duration stay manual.** Progression for bodyweight and
  time-based exercises is intentionally not automated in v1; they render no
  recommendation chip.

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

Feature modules under `src/features/`: `auth`, `dashboard`, `enrollment`,
`exercises`, `profile`, `programs`, `sessions`.

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
workout sessions, and progressive-overload recommendations are implemented.
Program generation via AI, progress dashboards with charts, OAuth, and email
verification are listed as planned work in the docs. No deployment or Docker
setup is included yet.

See [`docs/`](docs/) for architecture, conventions, database, testing, and UI
documentation, and [`AGENTS.md`](AGENTS.md) for the engineering rules AI agents
follow in this repository.