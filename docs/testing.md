# Testing Strategy

## Overview

Fit40's testing strategy prioritizes **domain and business logic tests** because they provide the highest value-to-effort ratio. UI and integration tests are used selectively for critical paths.

### Testing Pyramid

```
        /\
       /  \        E2E (minimal)
      /----\       Critical user flows only
     /      \
    /--------\     Integration (moderate)
   /          \    Repositories, use cases with real DB
  /------------\
 /              \  Unit (extensive)
/________________\ Domain services, value objects, use cases with mocks
```

---

## Test Framework

| Type | Framework | Location |
|------|-----------|----------|
| Unit | Vitest | `tests/unit/` |
| Integration | Vitest + test database | `tests/integration/` |
| E2E | Playwright | `tests/e2e/` |

### Configuration

- Vitest config in `vitest.config.ts` at project root.
- Test files use `*.test.ts` or `*.spec.ts` suffix.
- Test files mirror the source structure.

```
tests/
├── unit/
│   ├── domain/
│   │   ├── services/
│   │   │   ├── progressive-overload.test.ts
│   │   │   ├── volume-calculation.test.ts
│   │   │   └── exercise-selection.test.ts
│   │   ├── value-objects/
│   │   │   ├── rpe.test.ts
│   │   │   └── weight.test.ts
│   │   └── entities/
│   │       └── workout-session.test.ts
│   └── application/
│       └── use-cases/
│           ├── complete-workout.test.ts
│           └── enroll-in-program.test.ts
├── integration/
│   ├── repositories/
│   │   ├── workout-session-repository.test.ts
│   │   └── user-repository.test.ts
│   └── use-cases/
│       └── complete-workout.integration.test.ts
└── e2e/
    ├── auth.spec.ts
    ├── workout-flow.spec.ts
    └── program-enrollment.spec.ts
```

---

## Unit Tests

### What to Test

**Highest priority:**
- Domain services (progressive overload, volume calculation, exercise selection, program generation rules).
- Value objects (RPE, Weight, RepScheme construction and invariants).
- Entity factories (invariant enforcement).
- Application use cases (with mocked ports).

**Also test:**
- Pure utility functions in `src/lib/`.
- Zod schemas (validation rules).
- Mapping functions (DB ↔ Domain).

### What NOT to Test

- React component rendering details.
- Third-party library behavior.
- Trivial getters/setters.
- Framework internals (Next.js routing, React reconciliation).

### Domain Service Tests

Domain services are pure functions. Tests are simple and fast.

```typescript
import { describe, it, expect } from 'vitest';
import { calculateProgressiveOverload } from '@/domain/services/progressive-overload';
import { createRepScheme } from '@/domain/value-objects/rep-scheme';

describe('calculateProgressiveOverload', () => {
  it('increases weight when all sets completed at target RPE', () => {
    const currentScheme = createRepScheme(3, 8);
    const history = [
      { scheme: currentScheme, rpe: 7, completed: true },
      { scheme: currentScheme, rpe: 7, completed: true },
    ];

    const next = calculateProgressiveOverload(currentScheme, history);

    expect(next.weight.value).toBeGreaterThan(currentScheme.weight.value);
  });

  it('keeps weight the same when RPE is too high', () => {
    const currentScheme = createRepScheme(3, 8);
    const history = [
      { scheme: currentScheme, rpe: 9, completed: true },
    ];

    const next = calculateProgressiveOverload(currentScheme, history);

    expect(next.weight.value).toBe(currentScheme.weight.value);
  });

  it('deloads when consecutive sessions fail', () => {
    // ...
  });
});
```

### Value Object Tests

```typescript
import { describe, it, expect } from 'vitest';
import { createRPE } from '@/domain/value-objects/rpe';

describe('RPE', () => {
  it('creates valid RPE', () => {
    const result = createRPE(7);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.value).toBe(7);
    }
  });

  it('rejects RPE below 1', () => {
    const result = createRPE(0);
    expect(result.ok).toBe(false);
  });

  it('rejects RPE above 10', () => {
    const result = createRPE(11);
    expect(result.ok).toBe(false);
  });

  it('rejects non-integer RPE', () => {
    const result = createRPE(7.5);
    expect(result.ok).toBe(false);
  });
});
```

### Use Case Tests (with mocked ports)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CompleteWorkoutUseCase } from '@/application/use-cases/complete-workout';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';

describe('CompleteWorkoutUseCase', () => {
  function createMockRepository(): WorkoutSessionRepository {
    return {
      findById: vi.fn(),
      save: vi.fn(),
      findByUserId: vi.fn(),
    };
  }

  it('completes a workout session', async () => {
    const repo = createMockRepository();
    const useCase = new CompleteWorkoutUseCase(repo);

    vi.mocked(repo.findById).mockResolvedValue(mockSession);

    const result = await useCase.execute({ sessionId: mockSessionId });

    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ completedAt: expect.any(Date) })
    );
  });

  it('returns error if session not found', async () => {
    const repo = createMockRepository();
    const useCase = new CompleteWorkoutUseCase(repo);

    vi.mocked(repo.findById).mockResolvedValue(null);

    const result = await useCase.execute({ sessionId: mockSessionId });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SESSION_NOT_FOUND');
    }
  });
});
```

### Rules for Unit Tests

1. **Test behavior, not implementation.** Assert on outputs and observable effects.
2. **One logical assertion per test.** Multiple `expect()` calls are fine if they verify one behavior.
3. **Use descriptive test names.** The name should describe the scenario and expected outcome.
4. **Arrange-Act-Assert structure.** Keep tests readable.
5. **No mocking of domain objects.** Domain objects are plain TypeScript; use real instances.
6. **Mock only ports/dependencies.** Use cases mock repositories, not domain services.
7. **Deterministic tests.** No randomness, no real time. Use fixed dates and seeded values.

---

## Integration Tests

### What to Test

- Repository implementations against a real (test) database.
- Use cases with real repositories (verifying the full path from use case to DB).
- Database constraints and migrations.

### Test Database

Integration tests run against a dedicated PostgreSQL database, driven from
`tests/integration/database/setup.ts`. The suite is deliberately destructive — every test
drops and recreates the `public` schema — so it must never touch a real database:

- The connection string comes **only** from `TEST_DATABASE_URL`. There is **no fallback** to
  `DATABASE_URL`, a localhost default, or an in-memory store.
- `assertSafeTestDatabaseUrl` (in `tests/integration/database/test-database-url.ts`) runs
  before any client is created and rejects the run if the database name is not suffixed with
  `_test`, if the URL is malformed, or if it equals `DATABASE_URL`. The guard is pure, so it
  is covered by unit tests without a database.
- Test files run sequentially (`fileParallelism: false`) against one shared database; each
  test resets the data it relies on.

Set it up once per machine:

```bash
createdb fit40_kimi_test          # or: CREATE DATABASE fit40_kimi_test;
export TEST_DATABASE_URL=postgres://user:password@localhost:5432/fit40_kimi_test
```

### Repository Tests

Use the shared harness (`tests/integration/database/setup.ts`) plus the seeded catalog
fixtures (`tests/integration/database/fixtures.ts`). Each test reseeds the database so it
starts from a known state:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';

import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { loadOccurrence, startSession } from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';

describe('DrizzleWorkoutSessionRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('saves and retrieves the full session aggregate', async () => {
    const occurrence = await loadOccurrence();
    const session = startSession('session-001', occurrence);
    const repository = new DrizzleWorkoutSessionRepository(testDb);

    expect((await repository.save(session)).ok).toBe(true);

    const loaded = await repository.findById(session.id);
    expect(loaded?.exerciseLogs).toHaveLength(occurrence.exercises.length);
  });
});
```

Notes on the suite layout:

* **Repository round-trips** live in `tests/integration/database/repositories/` and assert on
  the domain objects that come back, not on row shapes.
* **Use cases against the real database** live in `tests/integration/database/use-cases/`.
  They exist to cover paths the unit suite cannot, such as the repository translating a
  PostgreSQL unique violation into the port's conflict result.
* **Constraint and referential-integrity tests** live in `tests/integration/database/schema/`
  and insert raw rows, because the repositories already refuse those shapes — the goal is to
  prove the database does too. `scheduled-workout-ownership.test.ts` pins the same-program
  rule there: a cross-program schedule entry is rejected, a same-program one succeeds, and
  deleting a workout still cascades to its occurrences.

### Session Concurrency Tests

Session saves are a compare-and-swap on `workout_sessions.version`, so the tests must show
that a *stale* aggregate is refused rather than applied. Two helpers make that readable:

* `readingAs(sessions, snapshot)` (`tests/integration/database/fixtures.ts`) answers every
  read with a captured snapshot while writes still go to real storage. That is exactly what an
  overlapping request looks like, and it lets PostgreSQL decide the loser.
* The unit equivalent wraps `InMemoryWorkoutSessionRepository`, which mirrors the same
  contract, so use cases can be tested without a database.

```typescript
// tests/integration/database/use-cases/session-concurrency.test.ts
const stale = await loadSessionOrThrow(sessions, sessionId);   // both writers start here
expect((await new LogSessionSetUseCase(sessions).execute(win)).ok).toBe(true);

const loser = await new LogSessionSetUseCase(readingAs(sessions, stale)).execute(lost);

expect(loser.ok).toBe(false);                                  // refused, not merged
if (loser.ok) return;
expect(loser.error).toMatchObject({ code: 'SESSION_MODIFIED' });
```

Together these pin three things: an accepted save reports the revision it stored, the
revision advances on every accepted write, and a refused save changes neither the parent row
nor its child rows.

### Rules for Integration Tests

1. **Use a real database.** Do not mock Drizzle.
2. **Isolate tests.** Each test reseeds the database rather than assuming prior state.
3. **Test the mapping.** Verify that domain objects survive the round-trip (save → load).
4. **Test constraints.** Verify that database constraints catch invalid data, using raw
   inserts that bypass the repositories.
5. **Assert on typed results, not driver errors.** A conflict must be asserted as
   `Result.err` / a use-case error code (`SESSION_ALREADY_EXISTS`), never as a `PostgresError`
   or SQLSTATE — the application layer is not allowed to see those.
6. **Keep integration tests focused.** They verify the DB layer works, not business logic
   (that's unit tests).

---

## E2E Tests

### What to Test

**Only critical user flows:**
1. User registration and login.
2. Enrolling in a program.
3. Starting and completing a workout session.
4. Viewing progress dashboard.

### What NOT to Test E2E

- Every form validation edge case (unit test the Zod schema instead).
- Every UI state (unit/integration tests cover logic).
- Styling and layout.
- Admin flows (unless critical).

### Rules for E2E Tests

1. **Minimal.** E2E tests are slow and brittle. Only test what matters.
2. **Test user journeys, not implementation.** Click buttons, fill forms, verify outcomes.
3. **Use stable selectors.** Prefer `data-testid` attributes over CSS selectors.
4. **Independent tests.** Each test starts from a clean state.
5. **No E2E tests for business logic.** If a test is verifying a calculation, it should be a unit test.

### Example E2E Test

```typescript
import { test, expect } from '@playwright/test';

test('user can complete a workout session', async ({ page }) => {
  // Arrange: log in and navigate to workout
  await page.goto('/login');
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.fill('[data-testid="password"]', 'password');
  await page.click('[data-testid="login-button"]');

  await page.goto('/workouts/next');

  // Act: start and complete workout
  await page.click('[data-testid="start-workout"]');

  // Log sets
  await page.fill('[data-testid="weight-input-0"]', '60');
  await page.fill('[data-testid="reps-input-0"]', '8');
  await page.click('[data-testid="log-set"]');

  await page.click('[data-testid="complete-workout"]');

  // Assert
  await expect(page.locator('[data-testid="workout-complete"]')).toBeVisible();
});
```

---

## Test Naming Conventions

### Test Files

- Unit: `[module-name].test.ts`
- Integration: `[module-name].integration.test.ts`
- E2E: `[flow-name].spec.ts`

### Test Names

```typescript
describe('calculateProgressiveOverload', () => {
  it('increases weight when all sets completed at target RPE', () => { ... });
  it('keeps weight the same when RPE is too high', () => { ... });
  it('deloads after three consecutive failed sessions', () => { ... });
});
```

Pattern: `[verb] [expected outcome] when [condition]`

---

## Test Data

### Factories

Create test data factories for domain objects.

```typescript
// tests/factories/workout-session.factory.ts
export function createMockWorkoutSession(overrides?: Partial<WorkoutSession>): WorkoutSession {
  return {
    id: createWorkoutSessionId(),
    userId: createUserId(),
    workoutId: createWorkoutId(),
    startedAt: new Date('2024-01-15T10:00:00Z'),
    completedAt: null,
    exerciseLogs: [],
    ...overrides,
  };
}
```

### Rules

1. **Use factories, not raw objects.** Factories provide sensible defaults.
2. **Override only what matters.** Each test overrides only the fields relevant to the test.
3. **Fixed timestamps.** Use deterministic dates, not `new Date()`.
4. **No shared mutable state.** Each test gets fresh data.

---

## Coverage Expectations

| Layer | Target Coverage | Notes |
|-------|----------------|-------|
| Domain services | > 90% | Critical business logic |
| Value objects | > 90% | Invariant enforcement |
| Application use cases | > 80% | With mocked ports |
| Repositories | > 70% | Integration tests |
| React components | No target | Test behavior via E2E if critical |
| Utilities | > 80% | Pure functions |

**Coverage is a guideline, not a goal.** 100% coverage with bad tests is worse than 80% with good tests.

---

## Running Tests

```bash
# Unit tests (no database required)
pnpm test

# Integration tests (requires TEST_DATABASE_URL pointing at a *_test database)
pnpm test:integration

# Type checking and linting
pnpm typecheck
pnpm lint
```

`pnpm test:integration` fails fast if `TEST_DATABASE_URL` is missing or does not name a
database suffixed with `_test`, so it cannot accidentally drop the development database.

---

## CI/CD Integration

1. **Run unit tests on every PR.** Fast, no external dependencies.
2. **Run integration tests on every PR.** Requires test database in CI.
3. **Run E2E tests on merge to main.** Slower, run less frequently.
4. **Fail the build on test failures.** No merging broken tests.
5. **Run type checking and linting** alongside tests.

---

## Anti-Patterns to Avoid

- ❌ Testing implementation details (internal function calls, private state).
- ❌ Snapshot tests for business logic (brittle, low value).
- ❌ Mocking everything (if you mock the domain, you're testing nothing).
- ❌ Tests that depend on execution order.
- ❌ Tests that depend on external services (network, real APIs).
- ❌ Ignoring failing tests (`it.skip`, `xit`) without a tracked issue.
- ❌ Testing third-party library behavior.
- ❌ Over-testing React rendering (shallow render, check class names, etc.).