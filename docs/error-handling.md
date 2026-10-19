# Error Handling

## Philosophy

Fit40 distinguishes between **expected failures** (business rule violations, validation errors) and **unexpected failures** (infrastructure crashes, bugs). Expected failures are returned as data using a `Result` type. Unexpected failures are thrown and caught by error boundaries.

**Core principle:** Do NOT use exceptions for expected business outcomes.

---

## The Result Type

### Definition

```typescript
// src/lib/result.ts

type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

### Usage

```typescript
// Domain service
function createRPE(value: number): Result<RPE, ValidationError> {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return err(ValidationError.invalidRPE(value));
  }
  return ok({ value });
}

// Use case
async function execute(input: CompleteWorkoutInput): Promise<Result<CompletedWorkoutDto, CompleteWorkoutError>> {
  const session = await sessionRepo.findById(input.sessionId);
  if (!session) {
    return err(CompleteWorkoutError.sessionNotFound(input.sessionId));
  }

  if (session.completedAt !== null) {
    return err(CompleteWorkoutError.alreadyCompleted(session.id));
  }

  // ... complete the workout
  return ok(dto);
}
```

### Rules

1. **Use `Result` for all expected failures.** Validation, business rules, not-found, authorization.
2. **Use exceptions for unexpected failures.** Database connection lost, network timeout, bugs.
3. **Never throw for business rule violations.** Return `err(...)`.
4. **Check `result.ok` before accessing `result.data`.** TypeScript narrows the type.
5. **Propagate errors explicitly.** Do not silently swallow errors.

---

## Error Categories

### 1. Validation Errors

**Cause:** User input does not meet schema requirements.
**Handling:** Return as `Result.err` with field-level details.
**HTTP:** 400 (if via API) or inline form errors.

```typescript
interface ValidationError {
  code: 'VALIDATION_ERROR';
  fieldErrors: Record<string, string[]>;
}
```

### 2. Domain / Business Rule Errors

**Cause:** A business rule prevents the operation.
**Handling:** Return as `Result.err` with a typed error code.
**HTTP:** 409 (Conflict) or 422 (Unprocessable Entity).

Examples:
- "Workout already completed"
- "Cannot enroll in program: already enrolled"
- "RPE value out of range"
- "Insufficient equipment for exercise"

```typescript
interface BusinessRuleError {
  code: string; // e.g., 'WORKOUT_ALREADY_COMPLETED'
  message: string;
  details?: Record<string, unknown>;
}
```

### 3. Authentication Errors

**Cause:** User is not authenticated.
**Handling:** Redirect to login (Server Components) or return 401 (API).
**Not a Result error.** Auth errors are handled at the middleware/layout level.

### 4. Authorization Errors

**Cause:** User is authenticated but lacks permission.
**Handling:** Return 403 or `Result.err` with `FORBIDDEN` code.
**Check in use cases,** not in UI.

```typescript
interface AuthorizationError {
  code: 'FORBIDDEN';
  message: string;
}
```

### 5. Not Found Errors

**Cause:** Requested resource does not exist.
**Handling:**
- Server Components: call `notFound()` from `next/navigation`.
- Use cases: return `Result.err` with `NOT_FOUND` code.
- API: return 404.

```typescript
interface NotFoundError {
  code: 'NOT_FOUND';
  resource: string;
  id: string;
}
```

### 6. Infrastructure Errors

**Cause:** Database unavailable, external API failure, network timeout.
**Handling:** Log the error. Return a generic error to the user. Alert in production.
**Not a Result error.** These are unexpected and should be thrown/caught by error boundaries.

### 7. Unexpected Errors

**Cause:** Bugs, unhandled edge cases.
**Handling:** Throw. Caught by error boundaries. Log with full context.
**Never expose stack traces to users.**

---

## Error Type Hierarchy

```typescript
// src/lib/errors.ts

// Base error type for the application
interface AppError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Specific error types
interface ValidationError extends AppError {
  code: 'VALIDATION_ERROR';
  fieldErrors: Record<string, string[]>;
}

interface BusinessRuleError extends AppError {
  code:
    | 'WORKOUT_ALREADY_COMPLETED'
    | 'ALREADY_ENROLLED'
    | 'PROGRAM_NOT_ACTIVE'
    | 'EXERCISE_NOT_AVAILABLE'
    | 'INVALID_PROGRESSION';
}

interface NotFoundError extends AppError {
  code: 'NOT_FOUND';
  resource: string;
  id: string;
}

interface AuthorizationError extends AppError {
  code: 'FORBIDDEN';
}

// Union of all expected errors
type ExpectedError = ValidationError | BusinessRuleError | NotFoundError | AuthorizationError;
```

---

## Error Handling by Layer

### Domain Layer

- **Returns `Result` from factories and services.**
- **Does not throw for invalid input.** Returns `err(...)`.
- **Does not catch errors.** No try/catch in domain code.
- **Error types are domain-specific.** `ValidationError`, `BusinessRuleError`.

```typescript
// Domain service
function calculateNextWeight(current: Weight, history: SetLog[]): Result<Weight, ProgressionError> {
  if (history.length === 0) {
    return err(ProgressionError.noHistory());
  }
  // ... calculation
  return ok(nextWeight);
}
```

### Application Layer

- **Returns `Result` from use cases.**
- **Checks authorization.** Returns `err(AuthorizationError)` if unauthorized.
- **Does not throw for expected failures.**
- **Throws for unexpected failures** (or lets them propagate).

```typescript
// Use case
async execute(input: CompleteWorkoutInput): Promise<Result<CompletedWorkoutDto, CompleteWorkoutError>> {
  const session = await this.sessionRepo.findById(input.sessionId);
  if (!session) {
    return err(CompleteWorkoutError.notFound(input.sessionId));
  }

  if (session.userId !== input.currentUserId) {
    return err(CompleteWorkoutError.forbidden());
  }

  if (session.completedAt !== null) {
    return err(CompleteWorkoutError.alreadyCompleted());
  }

  // ... complete
  return ok(dto);
}
```

### Infrastructure Layer

- **Catches database/external errors.**
- **Translates to application errors.**
- **Logs original errors.**
- **Does not leak Drizzle/PostgreSQL errors** to upper layers.

```typescript
// Repository
async save(session: WorkoutSession): Promise<void> {
  try {
    await db.insert(workoutSessions).values(mapToDbRow(session));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateSessionError(session.id);
    }
    // Log and re-throw unexpected errors
    console.error('Database error in WorkoutSessionRepository.save', error);
    throw error;
  }
}
```

### Presentation Layer (Server Actions)

- **Validates input.** Returns `Result.err` for validation failures.
- **Calls use cases.** Propagates `Result`.
- **Does not throw for expected errors.**
- **Revalidates data on success.**

```typescript
'use server';

export async function completeWorkout(input: unknown): Promise<Result<CompletedWorkoutDto, CompleteWorkoutError>> {
  const parsed = completeWorkoutSchema.safeParse(input);
  if (!parsed.success) {
    return err(CompleteWorkoutError.validation(parsed.error));
  }

  const result = await completeWorkoutUseCase.execute(parsed.data);

  if (result.ok) {
    revalidatePath('/workouts');
  }

  return result;
}
```

### Presentation Layer (React Components)

- **Checks `result.ok`** after Server Action calls.
- **Displays error messages** to the user.
- **Does not throw for expected errors.**
- **Error boundaries catch unexpected errors.**

```typescript
// Client Component
function CompleteWorkoutButton({ sessionId }: { sessionId: string }) {
  const [error, setError] = useState<string | null>(null);
  const { pending } = useFormStatus();

  async function handleClick() {
    const result = await completeWorkout({ sessionId });
    if (!result.ok) {
      setError(result.error.message);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={pending}>
        Complete Workout
      </button>
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
```

---

## Error Boundaries

### Next.js `error.tsx`

- Must be a Client Component.
- Catches unexpected errors in the route segment.
- Logs the error.
- Shows a user-friendly message.
- Provides a "try again" button.

```typescript
'use client';

// `retry` (not `reset`) is the recovery action. Verified against next@16.3.1:
// `ErrorInfo = { error: unknown; reset: () => void; retry: () => void }`, and the
// framework's `retry()` runs `context.refresh()` before `reset()` — so recovery
// fetches a FRESH Server Component response. `reset()` alone only clears the
// boundary and can replay the same failed response.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Log to error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 p-8">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      <button onClick={retry}>Try again</button>
    </div>
  );
}
```

### Rules

1. **Every route group should have an `error.tsx`.** Implemented in M19 S1: `(app)/error.tsx`, `(auth)/error.tsx`, and a root `global-error.tsx` (see below).
2. **Log errors in `useEffect`.** Do not log during render.
3. **Do not expose error details to users.** No stack traces, no internal messages. Boundaries log the raw `error` and render only fixed, user-facing copy via `ErrorState`; Next.js itself sends a digest, not the message, to the client.
4. **Provide a recovery path that fetches a fresh response.** "Try again" (`retry()`) is provided on every boundary. Verified against `next@16.3.1`: the framework hands each boundary a `retry` prop implemented as `startTransition(() => { context.refresh(); reset(); })`. `context.refresh()` requests a **fresh Server Component response**; `reset()` alone only clears boundary state and can replay the failed response, so a transient database/server failure would stay unrecoverable after the service recovers. Boundaries therefore wire the button to `retry`, never `reset`.
5. **A boundary does not cover its own layout.** Verified against `next@16.3.1`: a segment's `error.tsx` catches failures in its **child pages**, but a failure in that segment's own `layout.tsx` propagates to the parent — ultimately to the root `global-error.tsx`. Therefore a root-level `global-error.tsx` is required in addition to the route-group boundaries.
6. **Exactly one `main` landmark per page (M19 P2).** Each route-group layout already owns the single `<main>` for its subtree, so a segment `error.tsx` fallback renders a non-landmark `<div>` — never a second `<main>`. Only `global-error.tsx` renders a `<main>`, because when it renders it owns the entire HTML document (it supplies its own `<html>`/`<body>`).

Automated S1 tests verify Fit40-owned rendering, privacy, accessibility, callback delegation (including repeated retry attempts), and single-`main` composition. The refresh behavior above comes from prior inspection of the installed Next.js 16.3.1 runtime; production HTTP probes verified scope, redirects, 404s and payload privacy. These are distinct evidence sources, and no real-browser end-to-end retry/recovery test was performed. Tests must not import private framework internals to assert Next.js behavior.

### Root `global-error.tsx`

- Must be a Client Component and must render its own `<html>`/`<body>`.
- It is the **only** boundary that catches failures in the root layout (`src/app/layout.tsx`). When it renders, the application layout, fonts and Tailwind stylesheet have already failed, so it uses plain inline-styled HTML and no design tokens.

### Contracts the boundaries must preserve

- `redirect()` (including `requireUser`) is navigation, not a rendering failure — boundaries never intercept it.
- `notFound()` renders the 404 route, not an error boundary.
- Expected domain/application errors are returned as typed `Result`/view states and render their own truthful "unavailable"/empty copy. Unexpected failures are converted to recoverable errors only at this boundary layer — never into empty or successful results.


---

## Server Component Error Handling

### Not Found

Use `notFound()` from `next/navigation` when a resource is not found.

```typescript
import { notFound } from 'next/navigation';

export default async function WorkoutPage({ params }: { params: { id: string } }) {
  const workout = await getWorkout(params.id);
  if (!workout) {
    notFound();
  }

  return <WorkoutDetail workout={workout} />;
}
```

The root `src/app/not-found.tsx` is context-aware without adding an authorization
path of its own. It reads only the session cookie's presence (no database read,
no `getCurrentUser()`, no `requireUser()`) to choose between a dashboard and a
sign-in secondary link, alongside the public exercise catalog. It never
redirects, so `notFound()` keeps its native 404 status even when the database is
unreachable; a stale cookie is resolved by the destination page's own
`requireUser()` through the existing validated `next` mechanism.

### Unexpected Errors

Let them throw. The error boundary catches them.

```typescript
// Do NOT do this in Server Components:
try {
  const data = await fetchData();
} catch (error) {
  // Don't silently handle unexpected errors
}

// Let errors propagate to error.tsx
```

---

## Logging

### Rules

1. **Log all unexpected errors** with full context (stack trace, request ID, user ID if available).
2. **Do not log expected errors** (validation, business rules) at error level. They are normal.
3. **Log infrastructure errors** at the repository/integration level.
4. **Use structured logging** (JSON) in production.
5. **Include correlation IDs** for tracing requests across services.

### Log Levels

| Level | Use For |
|-------|---------|
| `error` | Unexpected errors, infrastructure failures |
| `warn` | Recoverable issues, deprecated API usage |
| `info` | Significant operations (workout completed, program enrolled) |
| `debug` | Detailed debugging info (development only) |

---

## Error Messages

### User-Facing Messages

- **Clear and actionable.** "This workout has already been completed."
- **No technical jargon.** No stack traces, no error codes.
- **Consistent tone.** Helpful, not blaming.

### Developer-Facing Messages

- **Include error code.** `WORKOUT_ALREADY_COMPLETED`
- **Include context.** Session ID, user ID, what was attempted.
- **Include original error** for infrastructure failures.

---

## Anti-Patterns

- ❌ Throwing exceptions for business rule violations.
- ❌ Catching errors and returning `null` silently.
- ❌ Using `any` for error types.
- ❌ Exposing stack traces to users.
- ❌ Logging expected errors at `error` level (noise).
- ❌ Swallowing errors in `catch` blocks without logging.
- ❌ Using `try/catch` for control flow in domain code.
- ❌ Generic error messages like "An error occurred" for expected failures.