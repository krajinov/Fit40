# Domain Modeling Rules

## Core Concepts

The Fit40 domain models fitness training for adults 40+. The domain is rich and must be modeled carefully to support progressive overload, program generation, exercise selection, and progress tracking.

---

## Entities

Entities have **identity** and **lifecycle**. Two entities with the same data but different IDs are different entities.

### Expected Entities

| Entity | Description | Identity |
|--------|-------------|----------|
| `User` | A registered user | `UserId` |
| `Profile` | User's fitness profile (goals, experience, limitations) | `UserId` (1:1 with User) |
| `Goal` | A fitness goal (strength, mobility, weight loss, etc.) | `GoalId` |
| `Equipment` | Available equipment types | `EquipmentId` |
| `Exercise` | An exercise definition | `ExerciseId` |
| `MuscleGroup` | A muscle group classification | `MuscleGroupId` |
| `TrainingProgram` | A structured training program | `ProgramId` |
| `ProgramWeek` | A week within a program | `ProgramWeekId` |
| `Workout` | A single workout within a program week | `WorkoutId` |
| `WorkoutExercise` | An exercise assigned to a workout with scheme | `WorkoutExerciseId` |
| `ProgramEnrollment` | A user's active enrollment in a program | `EnrollmentId` |
| `WorkoutSession` | A user's instance of performing a workout | `SessionId` |
| `ExerciseLog` | Log of performing one exercise in a session | `ExerciseLogId` |
| `SetLog` | Log of a single set (weight, reps, RPE) | `SetLogId` |

### Entity Rules

1. **Entities are immutable.** All properties are `readonly`. State changes produce new instances or use explicit methods.
2. **Identity is a branded type.** Never use raw `string` for IDs.
3. **Entities enforce their own invariants.** Invalid state cannot be constructed.
4. **Entities do not reference infrastructure types.** No Drizzle types, no HTTP types.
5. **Aggregates have a root.** `WorkoutSession` is the aggregate root for `ExerciseLog` and `SetLog`. External code accesses children through the root.

### Example Entity Shape (illustrative, not implementation)

```typescript
interface WorkoutSession {
  readonly id: WorkoutSessionId;
  readonly userId: UserId;
  readonly workoutId: WorkoutId;
  readonly enrollmentId: EnrollmentId;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly exerciseLogs: ReadonlyArray<ExerciseLog>;
  readonly notes: string | null;
}
```

---

## Value Objects

Value Objects are defined by their **values**, not identity. Two VOs with the same data are equal.

### Expected Value Objects

| Value Object | Description | Invariants |
|-------------|-------------|-----------|
| `RPE` | Rate of Perceived Exertion | Integer 1–10 |
| `Weight` | Weight value with unit | Positive number, unit (kg/lb) |
| `RepScheme` | Sets × reps prescription | Positive integers |
| `DateRange` | Start and end date | start ≤ end |
| `Percentage` | Percentage value | 0–100 |
| `Duration` | Time duration | Non-negative |

### Value Object Rules

1. **Immutable.** All fields `readonly`.
2. **Validated at construction.** Factory function or constructor enforces invariants.
3. **Compared by value.** Provide an `equals()` method or use structural comparison.
4. **No identity.** VOs do not have IDs.
5. **Self-documenting.** The type itself communicates constraints.

### Example Value Object Shape

```typescript
interface RPE {
  readonly value: number; // 1-10, integer
}

// Factory enforces invariant
function createRPE(value: number): Result<RPE, ValidationError> {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return err(ValidationError.invalidRPE(value));
  }
  return ok({ value });
}
```

---

## IDs

### Branded Types

All entity IDs use branded types to prevent mixing up IDs of different entities.

```typescript
type UserId = string & { readonly __brand: 'UserId' };
type WorkoutSessionId = string & { readonly __brand: 'WorkoutSessionId' };
type ProgramId = string & { readonly __brand: 'ProgramId' };
```

### ID Rules

1. **Never use raw `string` for IDs** in domain/application code.
2. **IDs are generated at the infrastructure boundary** (database or UUID generator).
3. **Domain code accepts and returns branded IDs.**
4. **Serialization** (to/from database, API) handles brand stripping/restoring at boundaries.
5. **ID format:** UUID v7 (time-ordered) preferred for database performance.

---

## Enums

### Const Object Pattern

Do NOT use TypeScript `enum`. Use const objects with derived union types.

```typescript
// ✅ Correct
const EquipmentType = {
  Barbell: 'barbell',
  Dumbbell: 'dumbbell',
  Kettlebell: 'kettlebell',
  ResistanceBand: 'resistance_band',
  Bodyweight: 'bodyweight',
  Machine: 'machine',
  Cable: 'cable',
} as const;

type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType];
```

```typescript
// ❌ Wrong
enum EquipmentType {
  Barbell = 'barbell',
  Dumbbell = 'dumbbell',
}
```

### Why Const Objects
- Tree-shakeable.
- No runtime enum object overhead.
- Better compatibility with `as const` assertions.
- Easier to extend.

### Expected Enums

| Enum | Values (examples) |
|------|-------------------|
| `EquipmentType` | barbell, dumbbell, kettlebell, bodyweight, machine, cable, band |
| `MuscleGroup` | chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, core, calves |
| `ExperienceLevel` | beginner, intermediate, advanced |
| `GoalType` | strength, hypertrophy, endurance, mobility, general_fitness, weight_loss |
| `WorkoutStatus` | scheduled, in_progress, completed, skipped |
| `SessionStatus` | not_started, in_progress, completed, abandoned |
| `ProgressionStrategy` | linear, double_progression, percentage_based, rpe_based |
| `PhysicalLimitation` | knee_issues, shoulder_issues, back_issues, hip_issues, wrist_issues, none |

---

## Timestamps

### Rules

1. **Domain layer uses `Date` objects.**
2. **Database stores UTC timestamps** (`timestamptz` in PostgreSQL).
3. **Serialization converts** between ISO 8601 strings (API/JSON) and `Date` objects.
4. **Never store local time.** Always UTC.
5. **Display formatting** happens in the presentation layer, not the domain.

### Fields

Every entity that is persisted should have:
- `createdAt: Date` — When the record was created.
- `updatedAt: Date` — When the record was last modified.

Domain-specific timestamps (e.g., `startedAt`, `completedAt`) are added as needed.

---

## Domain Invariants

Invariants are rules that must always be true. They are enforced **at construction time**, not checked repeatedly.

### Examples of Invariants

| Invariant | Where Enforced |
|-----------|---------------|
| RPE must be 1–10 | `createRPE()` factory |
| Weight must be positive | `createWeight()` factory |
| A completed session must have `completedAt` | `WorkoutSession` factory |
| A workout must have at least one exercise | `Workout` factory |
| Program weeks must be sequential | `TrainingProgram` factory |
| SetLog reps must be positive | `SetLog` factory |
| Enrollment start date must be ≤ end date (if set) | `ProgramEnrollment` factory |

### Enforcement Rules

1. **Factory functions** validate inputs and return `Result<Entity, Error>`.
2. **No invalid state can be constructed.** If validation fails, no object is created.
3. **Internal code trusts constructed objects.** No re-validation inside domain services.
4. **Boundary validation** (Zod) happens before domain construction.

---

## Nullable Values

### Rules

1. **Be explicit.** If a field can be absent, use `T | null` (not `T | undefined`).
2. **`null` means "explicitly absent."** `undefined` means "not provided."
3. **Domain objects prefer `null`** for optional fields (serializable, explicit).
4. **Avoid optional chaining chains.** If you find `a?.b?.c?.d`, reconsider the model.
5. **Use discriminated unions** instead of nullable fields when the presence/absence changes behavior.

### Example

```typescript
// ✅ Clear: session is either completed (has completedAt) or not
interface WorkoutSession {
  readonly completedAt: Date | null;
}

// ✅ Better if behavior differs:
type WorkoutSession =
  | { status: 'in_progress'; startedAt: Date }
  | { status: 'completed'; startedAt: Date; completedAt: Date };
```

---

## Database Models vs Domain Models

**The database schema is NOT the domain model.**

### Separation

| Concern | Location | Shape |
|---------|----------|-------|
| Database schema | `src/infrastructure/database/schema/` | Drizzle table definitions, snake_case columns, foreign keys |
| Domain model | `src/domain/entities/`, `src/domain/value-objects/` | TypeScript interfaces/classes, camelCase, branded IDs |
| Mapping | `src/infrastructure/database/repositories/` | Functions that convert DB rows ↔ Domain objects |

### Rules

1. **Drizzle schema types never leak** outside `src/infrastructure/`.
2. **Repositories map** DB rows to domain objects on read, and domain objects to DB rows on write.
3. **Domain objects may have different structure** than DB tables (e.g., a domain object may combine data from multiple tables, or flatten a JSON column).
4. **Foreign keys in DB** become branded ID references in domain.
5. **Database constraints** (NOT NULL, UNIQUE, CHECK) enforce invariants at the DB level as a safety net, but domain validation is the primary enforcement.

---

## DTOs (Data Transfer Objects)

DTOs define data shapes crossing layer boundaries.

### Where DTOs Live

- `src/application/dto/` — DTOs for use case inputs/outputs.
- `src/features/[feature]/types/` — Feature-specific view models (if different from application DTOs).

### Rules

1. **DTOs are plain types.** No behavior, no methods.
2. **DTOs are serializable.** No `Date` objects in DTOs that cross the server/client boundary — use ISO strings.
3. **Input DTOs** are validated with Zod at the boundary.
4. **Output DTOs** are constructed by use cases from domain objects.
5. **Do not reuse domain entities as DTOs** across the server/client boundary.

### Example

```typescript
// Application DTO (server-side)
interface WorkoutSessionDto {
  id: string;
  workoutName: string;
  startedAt: string; // ISO 8601
  completedAt: string | null;
  exerciseCount: number;
  totalVolume: number;
}
```

---

## Mapping Between Layers

### Read Path
```
DB Row (Drizzle type)
  → Repository maps to Domain Entity
    → Use Case maps to DTO
      → Server Component / Server Action returns to client
```

### Write Path
```
Client form data
  → Zod validates → Input DTO
    → Use Case constructs Domain Entity (via factory)
      → Repository maps Domain Entity to DB row
        → Drizzle inserts/updates
```

### Mapping Rules

1. **Mapping is explicit.** Write mapping functions, don't rely on structural typing accidents.
2. **Mapping lives in repositories** (DB ↔ Domain) and use cases (Domain ↔ DTO).
3. **No mapping in React components.** Components receive ready-to-render data.
4. **Mapping functions are pure** and testable.

---

## Validation

### Where Validation Happens

| Layer | Validates? | What |
|-------|-----------|------|
| Presentation (forms) | ✅ | User input shape and constraints (Zod) |
| Server Actions | ✅ | Re-validate input (never trust client) |
| Application (use cases) | ❌ | Input is already validated. Business rules checked via domain. |
| Domain (factories) | ✅ | Invariants (RPE range, positive weight, etc.) |
| Infrastructure (repositories) | ❌ | Trust domain objects. DB constraints are safety net. |

### Rules

1. **Validate once at the boundary.** Do not re-validate the same data at every layer.
2. **Domain factories enforce invariants**, not input shape.
3. **Zod schemas** define input shape. Domain factories define business invariants.
4. **Database constraints** are the last line of defense, not the primary validation.

---

## Aggregate Design

### Aggregates

| Aggregate Root | Contains |
|---------------|----------|
| `User` | `Profile` |
| `TrainingProgram` | `ProgramWeek[]`, `Workout[]`, `WorkoutExercise[]` |
| `ProgramEnrollment` | — |
| `WorkoutSession` | `ExerciseLog[]`, `SetLog[]` |
| `Exercise` | — |

### Rules

1. **External code accesses aggregate children through the root.** You don't query `SetLog` directly; you load `WorkoutSession` and access its logs.
2. **Repositories are per aggregate root.** `WorkoutSessionRepository`, not `SetLogRepository`.
3. **Transactions protect aggregate consistency.** All changes to an aggregate happen in one transaction.
4. **Cross-aggregate references use IDs**, not object references.

---

## Domain Events (Future)

Domain events represent something meaningful happening.

### Expected Events

- `WorkoutSessionCompleted`
- `ProgramEnrolled`
- `PersonalRecordAchieved`
- `WorkoutStreakMilestone`

### Rules

1. **Events are immutable.**
2. **Events are named in past tense.**
3. **Events carry minimal data** (IDs and timestamps). Consumers load full data if needed.
4. **Events are emitted by use cases**, not by entities directly.
5. **Event handling is async** and does not block the main operation.