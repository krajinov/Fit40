# Architecture

## Overview

Fit40 uses a **layered architecture** adapted for Next.js App Router. The design prioritizes:

1. **Testability** — Business logic is pure TypeScript, testable without React or a database.
2. **Separation of concerns** — UI, business logic, and data access are clearly separated.
3. **Framework independence** — Core domain logic has zero dependency on Next.js, React, or ORM.
4. **Pragmatism** — No unnecessary abstractions. Complexity is earned, not assumed.

---

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  src/app/ (routing, layouts, pages)                         │
│  src/features/ (feature UI, server actions, hooks)          │
│  src/components/ (shared UI)                                │
├─────────────────────────────────────────────────────────────┤
│                    APPLICATION LAYER                         │
│  src/application/use-cases/                                 │
│  src/application/ports/                                     │
│  src/application/dto/                                       │
├─────────────────────────────────────────────────────────────┤
│                      DOMAIN LAYER                            │
│  src/domain/entities/                                       │
│  src/domain/value-objects/                                  │
│  src/domain/services/                                       │
│  src/domain/events/                                         │
│  src/domain/types/                                          │
├─────────────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE LAYER                        │
│  src/infrastructure/database/ (Drizzle, repositories)       │
│  src/infrastructure/auth/                                   │
│  src/infrastructure/ai/                                     │
│  src/infrastructure/email/                                  │
└─────────────────────────────────────────────────────────────┘
```

### Dependency Rule

**Dependencies point inward only.**

- Presentation → Application → Domain
- Infrastructure → Application (implements ports) → Domain
- Domain depends on **nothing** outside itself.

---

## Domain Layer (`src/domain/`)

The domain layer is the heart of the application. It contains:

### Entities
Objects with identity and lifecycle. Examples: `User`, `TrainingProgram`, `WorkoutSession`.

```typescript
// Example structure (not implementation)
interface WorkoutSession {
  readonly id: WorkoutSessionId;
  readonly userId: UserId;
  readonly programId: ProgramId;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly exerciseLogs: ReadonlyArray<ExerciseLog>;
}
```

### Value Objects
Immutable objects defined by their values. Examples: `RPE`, `Weight`, `RepScheme`, `DateRange`.

```typescript
// Example structure
interface RPE {
  readonly value: number; // 1-10
}
```

### Domain Services
Pure functions that implement business rules. Examples:
- `calculateProgressiveOverload(currentScheme, history) → nextScheme`
- `calculateTrainingVolume(exerciseLogs) → Volume`
- `selectAlternativeExercises(exercise, limitations, equipment) → Exercise[]`
- `determineNextWorkout(program, completedSessions) → Workout`

### Domain Events
Events that represent something meaningful happening in the domain. Examples: `WorkoutCompleted`, `ProgramEnrolled`, `PersonalRecordAchieved`.

### Rules
- **No imports** from React, Next.js, Drizzle, HTTP libraries, or any framework.
- **No side effects.** Domain services are pure functions.
- **No database access.** Domain objects are plain TypeScript.
- **Invariants enforced at construction.** Factory functions validate inputs.
- **Immutable by default.** Use `readonly` and `ReadonlyArray`.

---

## Application Layer (`src/application/`)

The application layer orchestrates domain logic to fulfill use cases.

### Use Cases
Each use case represents a single user-facing operation. Examples:
- `CompleteWorkoutUseCase`
- `EnrollInProgramUseCase`
- `LogExerciseSetUseCase`
- `GenerateProgramUseCase`

A use case:
1. Accepts validated input (DTO).
2. Loads required data via ports (repositories).
3. Applies domain logic.
4. Persists changes via ports.
5. Returns a `Result` (success or typed error).

```typescript
// Example structure
interface CompleteWorkoutUseCase {
  execute(input: CompleteWorkoutInput): Promise<Result<CompletedWorkoutDto, CompleteWorkoutError>>;
}
```

### Ports (Interfaces)
The application layer defines **what** it needs, not **how** it's implemented.

```typescript
// Example port
interface WorkoutSessionRepository {
  findById(id: WorkoutSessionId): Promise<WorkoutSession | null>;
  save(session: WorkoutSession): Promise<void>;
  findByUserId(userId: UserId): Promise<WorkoutSession[]>;
}
```

Infrastructure provides implementations. The application layer never imports infrastructure directly.

### DTOs
Data Transfer Objects define the shape of data crossing layer boundaries. They are plain TypeScript interfaces/types with no behavior.

### Rules
- May import from `src/domain/` only.
- Must NOT import from `src/infrastructure/`, `src/app/`, `src/features/`, React, or Next.js.
- Use cases are the primary API consumed by the presentation layer.
- All public functions have explicit return types.

---

## Infrastructure Layer (`src/infrastructure/`)

The infrastructure layer implements ports defined by the application layer.

### Database (`src/infrastructure/database/`)
- **Schema:** Drizzle table definitions in `schema/`.
- **Repositories:** Implement application port interfaces. Map Drizzle rows ↔ Domain objects.
- **Client:** Database connection setup.
- **Migrations:** Generated by drizzle-kit. Never hand-edited.

### Auth (`src/infrastructure/auth/`)
- Auth provider integration (future).
- Session management.
- Token handling.

### AI (`src/infrastructure/ai/`)
- AI provider integration (future).
- Program generation via AI (future).
- Must implement an application port. Never called directly from domain or use cases.

### Rules
- May import from `src/domain/` and `src/application/` (for port types).
- Must NOT import from `src/app/` or `src/features/`.
- Must NOT contain business logic. Only data mapping and external API calls.
- Database errors are caught here and translated to domain/application errors.

---

## Presentation Layer (`src/app/`, `src/features/`, `src/components/`)

### Next.js App Router (`src/app/`)
- Defines routes, layouts, and page composition.
- Pages are thin. They compose feature components.
- Server Components fetch data and pass to Client Components.
- `loading.tsx`, `error.tsx`, `not-found.tsx` handle async states.

### Features (`src/features/`)
Feature modules organize presentation-layer code by domain feature.

Each feature contains:
- `components/` — React components specific to this feature.
- `actions/` — Server Actions (mutations).
- `hooks/` — Client-side hooks (if needed).
- `schemas/` — Zod validation schemas for this feature's inputs.
- `types/` — Feature-specific TypeScript types.

Server Actions in features:
1. Validate input with Zod.
2. Call an Application use case.
3. Return the Result.
4. Revalidate affected data.

**Server Actions do NOT contain business logic.** They are thin adapters between HTTP and the application layer.

### Shared Components (`src/components/`)
- `ui/` — shadcn/ui primitives. Never modified with business logic.
- `shared/` — Composite components used across features (e.g., `PageHeader`, `EmptyState`).

### Rules
- Components render UI and handle user interaction.
- Components do NOT contain business logic.
- Components call Server Actions for mutations.
- Server Components by default. Client Components only when needed.
- Keep Client Components small and leaf-level.

---

## Data Flow

### Read Path (Server Component)
```
Page (src/app/)
  → calls Application service / use case (read method)
    → calls Repository port
      → Infrastructure repository queries Drizzle
        → maps row to Domain object
      → returns Domain object
    → returns DTO
  → renders UI with data
```

### Write Path (Server Action)
```
Client Component (form submission)
  → Server Action (src/features/[feature]/actions/)
    → validates input with Zod
    → calls Application use case
      → loads entities via Repository port
      → applies Domain logic
      → persists via Repository port
      → returns Result
    → returns Result to client
  → revalidates data / updates UI
```

---

## Cross-Cutting Concerns

### Authentication
- Handled at the infrastructure level (`src/infrastructure/auth/`).
- A `getCurrentUser()` utility available to Server Components and Server Actions.
- Auth checks happen in layouts (route protection) and use cases (authorization).

### Authorization
- Ownership and permission checks happen in Application use cases.
- Never rely on UI hiding as authorization.
- Server Actions must verify the user has permission before executing.

### Caching
- Request-level: React `cache()` for deduplication within a request.
- Route-level: Next.js `revalidate` config.
- Tag-based: `revalidateTag()` after mutations.

### Background Jobs (Future)
- If background jobs are needed, they consume Application use cases.
- Job handlers live in `src/infrastructure/jobs/` or a dedicated worker.
- Jobs do NOT contain business logic.

### AI Integration (Future)
- AI providers are infrastructure concerns.
- The application layer defines a port: `ProgramGenerationService`.
- Infrastructure implements it using an AI provider.
- Domain logic validates and constrains AI output.
- The domain never knows an AI provider exists.

---

## What This Architecture Avoids

- ❌ "Fat" React components with business logic.
- ❌ Business logic in SQL queries.
- ❌ Tight coupling to Next.js in core logic.
- ❌ Tight coupling to ORM in domain objects.
- ❌ Global state management for server data.
- ❌ Premature abstractions and over-engineering.
- ❌ Circular dependencies between layers.