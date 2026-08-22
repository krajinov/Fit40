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

- Use a **separate PostgreSQL database** for tests (not production, not development).
- Configure via `DATABASE_URL_TEST` environment variable.
- **Reset the database** between test files (or use transactions with rollback).
- Run migrations before integration tests.

### Repository Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/workout-session-repository';
import { db } from '@/infrastructure/database/client';

describe('DrizzleWorkoutSessionRepository', () => {
  const repo = new DrizzleWorkoutSessionRepository();

  beforeAll(async () => {
    // Run migrations or seed test data
  });

  afterAll(async () => {
    // Clean up
  });

  it('saves and retrieves a workout session', async () => {
    const session = createMockWorkoutSession();
    await repo.save(session);

    const found = await repo.findById(session.id);

    expect(found).not.toBeNull();
    expect(found?.userId).toBe(session.userId);
    expect(found?.exerciseLogs).toHaveLength(session.exerciseLogs.length);
  });

  it('returns null for non-existent session', async () => {
    const found = await repo.findById(nonExistentId);
    expect(found).toBeNull();
  });
});
```

### Rules for Integration Tests

1. **Use a real database.** Do not mock Drizzle.
2. **Isolate tests.** Each test file gets a clean database state.
3. **Test the mapping.** Verify that domain objects survive the round-trip (save → load).
4. **Test constraints.** Verify that database constraints catch invalid data.
5. **Keep integration tests focused.** They verify the DB layer works, not business logic (that's unit tests).

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
# Unit tests
npm run test:unit

# Integration tests (requires test database)
npm run test:integration

# E2E tests (requires running app)
npm run test:e2e

# All tests
npm run test

# Coverage report
npm run test:coverage
```

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