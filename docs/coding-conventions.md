# Coding Conventions

This document covers TypeScript, React, Next.js, and validation conventions for Fit40.

---

## TypeScript

### Strict Mode

`tsconfig.json` must have `"strict": true`. No exceptions. This enables:
- `strictNullChecks`
- `noImplicitAny`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `alwaysStrict`

### No `any`

- **Never use `any`.** If the type is genuinely unknown, use `unknown`.
- **Never use `as any`.** This defeats the type system.
- **Never use `@ts-ignore` or `@ts-expect-error`** without a comment explaining why and a linked issue.

```typescript
// ❌ Bad
function parse(data: any) { ... }

// ✅ Good
function parse(data: unknown): Result<ParsedData, ParseError> { ... }
```

### Exhaustive Handling

All discriminated unions must be handled exhaustively. Use a `never` check for the default case.

```typescript
type WorkoutStatus = 'scheduled' | 'in_progress' | 'completed' | 'skipped';

function getStatusLabel(status: WorkoutStatus): string {
  switch (status) {
    case 'scheduled': return 'Scheduled';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    case 'skipped': return 'Skipped';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
```

### No Unsafe Casts

- Avoid `as` casts. If you must use one, add a comment explaining why it's safe.
- Avoid `!` non-null assertions. Use proper null checks, optional chaining, or type guards.

```typescript
// ❌ Bad
const user = result as User;
const name = user!.profile!.name;

// ✅ Good
if (result.ok) {
  const user = result.data;
  const name = user.profile?.name ?? 'Unknown';
}
```

### Explicit Return Types

All **public functions** in `src/domain/` and `src/application/` must have explicit return types.

```typescript
// ✅ Required in domain/application
export function calculateVolume(logs: ReadonlyArray<ExerciseLog>): Volume { ... }

// Optional in presentation/components (inferred is fine)
function formatWeight(weight: Weight) { ... }
```

### Type-Only Imports

Use `import type` for imports that are only used as types.

```typescript
import type { UserId } from '@/domain/types/ids';
import { createUser } from '@/domain/entities/user';
```

### Branded Types for IDs

```typescript
type UserId = string & { readonly __brand: 'UserId' };
type ProgramId = string & { readonly __brand: 'ProgramId' };
```

### Discriminated Unions Over Optional Fields

When the presence/absence of a field changes the meaning of the data, use a discriminated union.

```typescript
// ❌ Ambiguous
interface Session {
  completedAt?: Date;
  abandonmentReason?: string;
}

// ✅ Clear
type Session =
  | { status: 'in_progress'; startedAt: Date }
  | { status: 'completed'; startedAt: Date; completedAt: Date }
  | { status: 'abandoned'; startedAt: Date; reason: string };
```

### Make Invalid States Unrepresentable

Design types so that invalid states cannot be constructed.

```typescript
// ❌ Invalid state possible
interface RepScheme {
  sets: number;   // could be 0 or negative
  reps: number;   // could be 0 or negative
}

// ✅ Invalid state unrepresentable (via factory)
interface RepScheme {
  readonly sets: number; // guaranteed >= 1 by factory
  readonly reps: number; // guaranteed >= 1 by factory
}
```

---

## React

### Component Declaration

- Use `function` declarations. No arrow function components.
- Named exports only. No `default export` for components.
- No `React.FC`.

```typescript
// ✅ Good
export function WorkoutCard({ workout }: WorkoutCardProps) {
  return <div>...</div>;
}

// ❌ Bad
export default function WorkoutCard() { ... }
const WorkoutCard: React.FC<Props> = () => { ... }
```

### Props

- Props interface named `ComponentNameProps`.
- Destructure props in the function signature.
- No spreading `...props` unless passing to a DOM element.

```typescript
interface WorkoutCardProps {
  workout: WorkoutDto;
  onSelect: (id: WorkoutId) => void;
}

export function WorkoutCard({ workout, onSelect }: WorkoutCardProps) {
  // ...
}
```

### State

- **Avoid `useState` for derived values.** Calculate them.
- **Avoid `useEffect` for state synchronization.** Derive instead.
- **Local state only for UI concerns** (open/closed, selected tab, form input).

```typescript
// ❌ Bad
const [filtered, setFiltered] = useState<Exercise[]>([]);
useEffect(() => {
  setFiltered(exercises.filter(e => e.equipment === selectedEquipment));
}, [exercises, selectedEquipment]);

// ✅ Good
const filtered = exercises.filter(e => e.equipment === selectedEquipment);
```

### Effects

`useEffect` is for **synchronization with external systems**, not for derived state.

Valid uses:
- Subscribing to browser APIs (resize, media queries).
- Syncing with third-party widgets.
- Cleanup of DOM mutations.

Invalid uses:
- Computing derived state.
- Fetching data (use Server Components).
- Syncing state that can be derived.

### Memoization

- **Do not use `useMemo` or `useCallback` by default.**
- Use them only when there is a **measured performance problem**.
- Premature memoization adds complexity without benefit.

### Hooks

- Custom hooks start with `use`.
- Hooks live in `src/features/[feature]/hooks/` or `src/lib/hooks/` if shared.
- Hooks do not contain business logic. They manage UI state or browser APIs.

### Forms

Forms follow the established Server Action architecture.

- Use native `<form>` elements bound to Next.js Server Actions.
- Use `useActionState` (in small client components) when client-side action state is required; use `useFormStatus` for loading state.
- Shared Zod schemas define boundary validation. Server-side validation is authoritative and always runs.
- Client-side validation (e.g. HTML `required`/`min`/`max` attributes) may improve UX but is not a security boundary and never replaces server-side validation.
- Expected validation/business errors are returned to the form as typed action state (a discriminated union). Unexpected errors are thrown — never silently converted into validation errors.
- Do not introduce React Hook Form, `@hookform/resolvers`, or another form-management library unless form complexity clearly justifies it and the dependency is explicitly approved.
- Reset form on success. Preserve values on validation error.

```tsx
// Established pattern (see src/features/sessions/components/SetLoggerForm.tsx)
'use client';

const [state, formAction, pending] = useActionState(submitAction, initialState);

return (
  <form action={formAction}>
    {/* native fields; validation is enforced server-side by the action's Zod schema */}
  </form>
);
```

### Component Size

- Maximum ~150 lines per component.
- Extract sub-components when a component grows.
- Each component should have a single responsibility.

### Component Composition

- Pages compose feature components.
- Feature components compose shared components and UI primitives.
- Avoid deep prop drilling. Use composition (children, render props) or context sparingly.

---

## Next.js

### App Router Structure

```
src/app/
├── layout.tsx          # Root layout (html, body, providers)
├── page.tsx            # Landing page
├── loading.tsx         # Global loading
├── error.tsx           # Global error boundary
├── not-found.tsx       # Global 404
├── (auth)/             # Route group: auth pages
│   ├── login/page.tsx
│   └── register/page.tsx
├── (dashboard)/        # Route group: main app
│   ├── layout.tsx      # Dashboard layout (sidebar, nav)
│   ├── page.tsx        # Dashboard home
│   ├── programs/
│   ├── workouts/
│   ├── exercises/
│   └── progress/
└── api/                # Route Handlers (webhooks only)
```

### Layouts

- Layouts provide shared UI (navigation, sidebar, header).
- Layouts are **Server Components** by default.
- Keep layouts thin. They should not fetch data or contain logic.
- **Never add `"use client"` to a layout.**

### Pages

- Pages are **Server Components** by default.
- Pages fetch data and pass it to feature components.
- Pages are thin. They compose, they don't implement.
- Use `generateMetadata` for dynamic metadata.

### Server Components (Default)

Every component is a Server Component unless it needs:
- `useState`, `useReducer`
- `useEffect`, `useLayoutEffect`
- `useRef` (for DOM)
- Event handlers (`onClick`, `onChange`, etc.)
- Browser APIs (`window`, `localStorage`, etc.)
- shadcn/ui interactive primitives (Dialog, Dropdown, etc.)

### Client Components

- Add `"use client"` at the **top of the file**, first line.
- Keep Client Components **small and leaf-level**.
- Extract interactive parts into separate Client Components.
- **Do NOT make a parent Client Component just because a child needs interactivity.**

```typescript
// ❌ Bad: Entire page becomes client
'use client';
export default function WorkoutPage() {
  // ... lots of server-fetchable data
  return <InteractiveButton />;
}

// ✅ Good: Server page, client leaf
export default function WorkoutPage() {
  const data = await getWorkout();
  return (
    <div>
      <h1>{data.name}</h1>
      <InteractiveButton workoutId={data.id} />
    </div>
  );
}
```

### Server Actions

- Use for **mutations** (create, update, delete).
- Define in `src/features/[feature]/actions/`.
- Mark with `'use server'`.
- Validate input with Zod.
- Delegate to Application use cases.
- Return `Result<T, E>`.
- Call `revalidatePath()` or `revalidateTag()` after success.

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
    revalidateTag('workout-sessions');
  }

  return result;
}
```

### Route Handlers

- Use **only** for: webhooks, external API callbacks, file uploads, SSE.
- Do NOT use for standard CRUD. Use Server Actions.
- Validate input. Handle errors explicitly.

### Data Fetching

- **Server Components fetch data directly.** No `useEffect` fetching.
- Use `async/await` in Server Components.
- Use React `cache()` for request-level deduplication.

```typescript
import { cache } from 'react';

export const getWorkout = cache(async (id: WorkoutId) => {
  return workoutRepository.findById(id);
});
```

### Caching & Revalidation

| Strategy | Use Case |
|----------|----------|
| `cache()` (React) | Deduplicate data fetching within a single request |
| `revalidatePath()` | Invalidate a specific route after mutation |
| `revalidateTag()` | Invalidate all routes with a tag after mutation |
| `unstable_cache` | Cache expensive computations across requests |
| `export const revalidate = N` | Time-based revalidation for semi-static pages |

### Loading, Error, Not Found

- `loading.tsx` — Automatic Suspense boundary. Show skeleton/spinner.
- `error.tsx` — Error boundary. Must be a Client Component. Log errors. Show user-friendly message.
- `not-found.tsx` — 404 page. Use `notFound()` from `next/navigation` to trigger.

```typescript
// error.tsx (must be client)
'use client';

export function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error); // Log to error reporting service
  }, [error]);

  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

---

## Validation

### Zod Schemas

- Schemas named `camelCase` with `Schema` suffix: `createWorkoutSchema`.
- Schemas live in `src/features/[feature]/schemas/` or `src/lib/schemas/` if shared.
- Use `.strict()` on object schemas to reject unknown keys.
- Use `.transform()` sparingly. Prefer explicit mapping.

### Validation Boundaries

| Input Source | Validate? | How |
|-------------|-----------|-----|
| HTTP request body/params | ✅ Yes | Zod at Server Action / Route Handler |
| Form input | ✅ Yes | Zod + RHF resolver (client) + re-validate server |
| Route params | ✅ Yes | Zod in Server Component or Action |
| Query params | ✅ Yes | Zod |
| Environment variables | ✅ Yes | Zod at startup (`src/lib/env.ts`) |
| Database records | ❌ No | Trust schema. Map to domain. |
| Internal domain objects | ❌ No | Invariants at construction. |
| Cross-layer DTOs | ❌ No | Type-checked at compile time. |

### Environment Variables

Validate environment variables at application startup.

```typescript
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);
```

### Do Not Re-Validate

Once data is validated at a boundary, internal layers trust it.

```
Server Action → Zod validates → Use Case → Domain
                    ↑ boundary               ↑ trusted from here on
```

---

## Styling

### Tailwind CSS

- Use **utility classes only**. No custom CSS files except `globals.css`.
- No inline `style={}` unless the value is dynamically computed.
- No CSS modules, styled-components, or CSS-in-JS.
- Use `cn()` from shadcn for conditional classes.

```typescript
// ✅ Good
<div className={cn('rounded-lg border p-4', isActive && 'border-primary')} />

// ❌ Bad
<div style={{ padding: 16, borderRadius: 8 }} />
```

### Dark Mode

- Design with dark mode in mind from the start.
- Use Tailwind `dark:` variant.
- Use CSS variables for theme tokens (shadcn pattern).

### Responsive Design

- Mobile-first. Default styles are for mobile.
- Use `sm:`, `md:`, `lg:`, `xl:` breakpoints for larger screens.
- Test at all breakpoints.

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files (components) | PascalCase | `WorkoutCard.tsx` |
| Files (non-component) | kebab-case | `progressive-overload.ts` |
| React components | PascalCase | `WorkoutCard` |
| Hooks | camelCase with `use` | `useWorkoutTimer` |
| Functions | camelCase, verb-first | `calculateNextWeight` |
| Domain entities | PascalCase | `WorkoutSession` |
| Value objects | PascalCase | `RepScheme` |
| Enums (const objects) | PascalCase | `EquipmentType` |
| DTOs | PascalCase + `Dto` | `CreateWorkoutDto` |
| Zod schemas | camelCase + `Schema` | `createWorkoutSchema` |
| Repositories | PascalCase + `Repository` | `WorkoutSessionRepository` |
| Use cases | PascalCase + `UseCase` | `CompleteWorkoutUseCase` |
| Server Actions | camelCase, verb-first | `completeWorkout` |
| DB tables | snake_case, plural | `workout_sessions` |
| DB columns | snake_case | `created_at` |
| Test files | `*.test.ts` | `progressive-overload.test.ts` |

---

## Import Rules

### Absolute Imports

Use `@/` alias for all imports within `src/`.

```typescript
import { calculateVolume } from '@/domain/services/volume';
import { Button } from '@/components/ui/button';
```

### Import Order

1. External packages (`react`, `next`, `zod`, etc.)
2. Internal absolute imports (`@/domain/`, `@/application/`, etc.)
3. Relative imports (`./`, `../`)

```typescript
import { useState } from 'react';
import { z } from 'zod';

import { WorkoutSession } from '@/domain/entities/workout-session';
import { completeWorkoutUseCase } from '@/application/use-cases/complete-workout';

import { WorkoutCard } from './WorkoutCard';
```

### Type Imports

Use `import type` for type-only imports.

```typescript
import type { UserId } from '@/domain/types/ids';
import { createUserId } from '@/domain/types/ids';