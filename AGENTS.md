# AGENTS.md — Fit40 Repository Rules

This file is the **canonical source of truth** for AI coding agents and human developers working in this repository. All architectural decisions, coding conventions, and engineering rules defined here must be followed. Detailed documentation lives in `docs/`. Cursor-specific rules in `.cursor/rules/` are concise summaries that reference this file and `docs/`.

---

## Product Context

**Fit40** is a fitness and training platform for adults aged 40+. It covers user profiles, training programs, workout tracking, progressive overload, exercise selection with equipment/limitation awareness, progress dashboards, and potentially AI-assisted program generation.

**Tech stack (fixed):** Next.js (App Router), TypeScript (strict), React, Tailwind CSS, shadcn/ui, PostgreSQL, Drizzle ORM, Zod, React Hook Form.

---

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────────────┐
│  Presentation (Next.js App Router, React, UI)   │  ← Depends on Application
├─────────────────────────────────────────────────┤
│  Application (Use Cases, Orchestration)         │  ← Depends on Domain
├─────────────────────────────────────────────────┤
│  Domain (Entities, Value Objects, Services)     │  ← Depends on NOTHING external
├─────────────────────────────────────────────────┤
│  Infrastructure (Database, Auth, AI, External)  │  ← Implements Application ports
└─────────────────────────────────────────────────┘
```

**Dependency direction is strictly downward.** Inner layers must never import from outer layers.

| Layer | Location | May depend on | Must NOT depend on |
|-------|----------|---------------|-------------------|
| Domain | `src/domain/` | Nothing external | React, Next.js, Drizzle, HTTP, auth providers, AI providers |
| Application | `src/application/` | Domain | React, Next.js, Drizzle, HTTP |
| Infrastructure | `src/infrastructure/` | Domain, Application (ports) | React, Next.js |
| Presentation | `src/app/`, `src/features/` | Application, Domain, Infrastructure (via DI) | — |

### Key Principles

1. **Domain logic is pure TypeScript.** No framework imports. Fully unit-testable without React or a database.
2. **Business logic lives in Domain and Application layers.** Never in React components, API routes, or database queries.
3. **Infrastructure implements ports (interfaces) defined in Application.** The Application layer defines what it needs; Infrastructure provides how.
4. **React components are thin.** They render UI and delegate all logic to application/domain services.
5. **Server Components by default.** Client Components only where interactivity requires it, and kept as small as possible.
6. **Feature-oriented presentation.** UI is organized by feature, not by technical type.

---

## Project Structure

```
src/
├── app/                        # Next.js App Router (routes, layouts, pages)
│   ├── (auth)/                 # Route group: auth-related pages
│   ├── (dashboard)/            # Route group: main app pages
│   ├── api/                    # Route Handlers (webhooks, external APIs)
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing page
│   ├── loading.tsx
│   ├── error.tsx
│   └── not-found.tsx
│
├── domain/                     # Pure domain logic (NO framework dependencies)
│   ├── entities/               # Domain entities (User, WorkoutSession, etc.)
│   ├── value-objects/          # Value objects (RPE, Weight, RepScheme, etc.)
│   ├── services/               # Domain services (progressive overload calc, etc.)
│   ├── events/                 # Domain events
│   ├── types/                  # Domain-specific types and enums
│   └── index.ts                # Public domain API
│
├── application/                # Use cases and orchestration
│   ├── use-cases/              # Individual use case modules
│   ├── ports/                  # Interfaces (repository contracts, external service contracts)
│   ├── dto/                    # Data Transfer Objects
│   └── index.ts
│
├── infrastructure/             # External integrations
│   ├── database/               # Drizzle schema, repositories, migrations
│   │   ├── schema/             # Drizzle table definitions
│   │   ├── repositories/       # Repository implementations
│   │   ├── migrations/         # Generated migrations
│   │   └── client.ts           # Database client
│   ├── auth/                   # Auth provider integration (future)
│   ├── ai/                     # AI provider integration (future)
│   └── email/                  # Email service (future)
│
├── features/                   # Feature modules (presentation layer)
│   ├── auth/                   # Auth UI, actions, hooks
│   ├── profile/                # Profile/onboarding
│   ├── programs/               # Training programs
│   ├── workouts/               # Workout sessions, logging
│   ├── exercises/              # Exercise catalog, alternatives
│   ├── progress/               # Dashboards, charts, history
│   └── [feature]/
│       ├── components/         # Feature-specific React components
│       ├── actions/            # Server Actions
│       ├── hooks/              # Feature-specific client hooks
│       ├── schemas/            # Zod schemas for this feature
│       └── types/              # Feature-specific types
│
├── components/                 # Shared UI components
│   ├── ui/                     # shadcn/ui primitives (DO NOT modify with business logic)
│   └── shared/                 # Shared composite components
│
├── lib/                        # Shared utilities
│   ├── utils.ts                # General utilities (cn, formatDate, etc.)
│   ├── result.ts               # Result type
│   └── errors.ts               # Error types and handling
│
├── types/                      # Shared TypeScript types
│
└── styles/                     # Global styles (minimal)
    └── globals.css

docs/                           # Architecture and convention documentation
tests/                          # Test files (mirrors src/ structure)
├── unit/
├── integration/
└── e2e/
```

### Boundary Rules

- **`src/domain/`** must have ZERO imports from `src/app/`, `src/features/`, `src/infrastructure/`, `react`, `next`, `drizzle-orm`, or any HTTP/auth/AI library.
- **`src/application/`** may import from `src/domain/` only. It defines port interfaces that infrastructure implements.
- **`src/infrastructure/`** may import from `src/domain/` and `src/application/` (for port types). It must not import from `src/app/` or `src/features/`.
- **`src/features/`** and **`src/app/`** may import from all layers but should primarily use Application-layer APIs.
- **`src/components/ui/`** contains shadcn/ui primitives. Never add business logic here.
- **`src/components/shared/`** contains reusable composite components without business logic.

---

## Domain Modeling Rules

See `docs/domain-modeling.md` for full details.

### Summary

- **Entities** have identity (ID) and lifecycle. Use branded types for IDs: `type UserId = string & { readonly __brand: 'UserId' }`.
- **Value Objects** are immutable, compared by value, have no identity. Examples: `RPE`, `Weight`, `RepScheme`, `DateRange`.
- **Enums** use TypeScript `const` objects with derived union types, not TypeScript `enum` keyword.
- **Timestamps** use ISO 8601 strings or `Date` objects consistently. Domain layer uses `Date`; serialization handles conversion.
- **Domain invariants** are enforced in entity constructors/factory functions, not scattered across the codebase.
- **Nullable values** must be explicit. Use `Option` pattern or explicit `null`/`undefined` with clear semantics.
- **Database models ≠ Domain models.** Drizzle schema types are infrastructure concerns. Map to domain objects at the repository boundary.
- **DTOs** are defined in the Application layer for data crossing layer boundaries.
- **Validation** happens at system boundaries (API input, form submission). Internal domain objects are trusted once constructed.

---

## Business Logic Rules

Business logic MUST live in `src/domain/services/` or `src/application/use-cases/`.

**Domain services** handle pure logic: progressive overload calculation, volume computation, exercise filtering rules, program generation rules.

**Application use cases** handle orchestration: "complete a workout session" (load session, apply domain logic, persist, emit events).

### Forbidden locations for business logic:
- ❌ React components
- ❌ Server Actions (they should delegate to use cases)
- ❌ Route Handlers (they should delegate to use cases)
- ❌ Database queries (no business logic in WHERE clauses or computed columns)
- ❌ Utility functions in `lib/` (unless truly generic)

### Testing business logic:
- Domain services: pure unit tests, no mocks needed
- Application use cases: unit tests with mocked ports/repositories

---

## Next.js Rules

See `docs/coding-conventions.md` for full details.

### App Router
- Use file-based routing with route groups for organization.
- `layout.tsx` for shared UI. Keep layouts thin.
- `page.tsx` for route entry points. Pages compose features.
- `loading.tsx` for Suspense boundaries.
- `error.tsx` for error boundaries.
- `not-found.tsx` for 404 handling.

### Server Components (default)
- All components are Server Components unless they need interactivity.
- Fetch data in Server Components directly via application services.
- Pass serializable props to Client Components.

### Client Components
- Add `"use client"` only when the component uses: `useState`, `useEffect`, `useRef`, event handlers, browser APIs, or shadcn/ui interactive primitives.
- Keep Client Components small. Extract interactive parts into leaf components.
- Never put `"use client"` on a layout or high-level page component.
- Do NOT create a Client Component just because a child needs interactivity — push the boundary down.

### Server Actions
- Use for mutations (form submissions, state changes).
- Validate input with Zod at the action boundary.
- Delegate to Application use cases.
- Return typed `Result` objects.
- Always revalidate affected data after mutations.

### Route Handlers
- Use only for: webhooks, external API integrations, file uploads, SSE.
- Do NOT use Route Handlers for standard CRUD — use Server Actions.

### Data Fetching
- Server Components fetch data directly (no `useEffect` fetching).
- Use `async/await` in Server Components.
- Use React `cache()` for request-level deduplication.
- Use Next.js `unstable_cache` or `revalidateTag` for persistent caching when appropriate.

### Mutations
- All mutations go through Server Actions.
- Server Actions call Application use cases.
- Use `useFormStatus` / `useOptimistic` for loading/optimistic UI.

---

## React Rules

See `docs/coding-conventions.md` for full details.

- Components are functions. Use `function ComponentName()` syntax.
- Props interfaces named `ComponentNameProps`.
- No `React.FC`. No `default export` for components (use named exports).
- Avoid `useEffect` for derived state. Calculate it.
- Avoid `useState` for values derivable from props or other state.
- Avoid `useMemo`/`useCallback` unless there is a measured performance need.
- Avoid global state (Redux, Zustand) unless a clear need emerges. Prefer server state + URL state + local component state.
- Forms use React Hook Form + Zod resolver.
- Feature components live in `src/features/[name]/components/`.
- Shared components live in `src/components/`.

---

## TypeScript Rules

See `docs/coding-conventions.md` for full details.

- `strict: true` in `tsconfig.json`. No exceptions.
- No `any`. Use `unknown` when type is genuinely unknown.
- Exhaustive switch/if handling for discriminated unions. Use `never` check.
- No `as` casts unless absolutely necessary with a comment explaining why.
- No `!` non-null assertions. Use proper null checks or optional chaining.
- Explicit return types on all public domain/application functions.
- Use `type` imports for type-only imports: `import type { Foo } from './foo'`.
- Prefer branded types for IDs and domain-specific primitives.
- Prefer discriminated unions over optional fields for variant types.
- Make invalid states unrepresentable.

---

## Validation Strategy

See `docs/coding-conventions.md` for full details.

| Input Source | Validate? | How |
|-------------|-----------|-----|
| HTTP request body/params | ✅ Yes | Zod schema at Server Action / Route Handler boundary |
| Form input | ✅ Yes | Zod schema + React Hook Form resolver (client) + re-validate server-side |
| Route params | ✅ Yes | Zod schema in Server Component or Action |
| Query params | ✅ Yes | Zod schema |
| Environment variables | ✅ Yes | Zod schema at app startup (`src/lib/env.ts`) |
| Database records | ❌ No | Trust the schema. Map to domain objects. |
| Internal domain objects | ❌ No | Invariants enforced at construction. |
| Cross-layer DTOs | ❌ No | Type-checked at compile time. |

**Do not re-validate data that has already been validated at a boundary.**

---

## Database Rules (Drizzle ORM)

See `docs/database.md` for full details.

### Why Drizzle
- TypeScript-first: schema defined in `.ts` files, not a DSL.
- SQL-first: explicit control over queries (important for complex fitness analytics).
- No heavy code generation step.
- Lightweight runtime.
- Better alignment with "database schema ≠ domain model" philosophy.

### Rules
- Schema files in `src/infrastructure/database/schema/`.
- Repository pattern: each aggregate has a repository implementing an Application port.
- Repositories map Drizzle rows → Domain objects. Components never see raw DB types.
- No ORM access in React components. Ever.
- Use `select()` explicitly. Avoid `select: true` / `include` that over-fetches.
- Use transactions for multi-step mutations.
- Migrations generated via `drizzle-kit`. Never edit generated migration files.
- Indexes on foreign keys and frequently queried columns.
- Use database constraints (NOT NULL, UNIQUE, CHECK, FK) to enforce invariants at the DB level.
- Handle database errors at the repository level. Translate to domain/application errors.

---

## Authentication & Authorization (Future)

- Authentication (who are you?) and Authorization (what can you do?) are separate concerns.
- Auth provider integration lives in `src/infrastructure/auth/`.
- A `getCurrentUser()` helper in `src/application/` or `src/lib/auth.ts` returns the authenticated user or null.
- Ownership checks happen in Application use cases, not in UI.
- Authorization is enforced in Server Actions and use cases, not by hiding UI elements.
- Protected routes use middleware or layout-level checks.
- Hiding a button ≠ authorization. The mutation itself must verify permission.

---

## Forms & Mutations

- React Hook Form + `@hookform/resolvers/zod`.
- Client-side validation for UX. Server-side validation for security.
- Server Actions return `Result<T, E>` discriminated union.
- Expected errors (validation, business rules) are returned as data, not thrown.
- Unexpected errors are thrown and caught by error boundaries.
- Use `useFormStatus` for loading states.
- Use `useOptimistic` for optimistic updates where appropriate.
- Reset form on success. Preserve values on validation error.

---

## Error Handling

See `docs/error-handling.md` for full details.

### Error Categories
| Category | Handling |
|----------|----------|
| Validation errors | Return as `Result.err` with field-level details |
| Domain/business rule errors | Return as `Result.err` with typed error codes |
| Auth errors | Redirect to login or return 401 |
| Authorization errors | Return 403 / `Result.err` |
| Not found | Return 404 / `notFound()` in Server Components |
| Infrastructure errors | Log, return generic error to user, alert in production |
| Unexpected errors | Throw. Caught by error boundaries. Log. |

### Result Type
```typescript
type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };
```

- Use `Result` for expected failures (business rules, validation).
- Use exceptions for truly unexpected failures (DB connection lost, network timeout).
- Do NOT use try/catch for expected business outcomes.

---

## UI Architecture

- **shadcn/ui primitives** in `src/components/ui/`. Do not modify with business logic.
- **Shared composites** in `src/components/shared/`. Reusable across features.
- **Feature components** in `src/features/[name]/components/`. Feature-specific UI.
- **Pages** in `src/app/` compose features. Pages should be thin.
- Responsive design: mobile-first with Tailwind breakpoints.
- Accessibility: semantic HTML, ARIA attributes, keyboard navigation, focus management.
- Loading states: use `loading.tsx`, Suspense, and skeleton components.
- Empty states: always design for empty data.
- Error states: use `error.tsx` and inline error messages.

---

## Styling

- Tailwind CSS utilities only. No custom CSS files except `globals.css`.
- No inline `style={}` unless dynamically computed values require it.
- No CSS modules, styled-components, or other CSS-in-JS.
- Use `cn()` utility (from shadcn) for conditional classes.
- Dark mode: use Tailwind `dark:` variant. Design with dark mode in mind from the start.
- Design tokens via Tailwind config / CSS variables.

---

## Testing Strategy

See `docs/testing.md` for full details.

### Unit Tests (highest priority)
- Domain services and value objects.
- Application use cases (with mocked ports).
- Pure utility functions.
- Framework: Vitest.

### Integration Tests
- Repository implementations against a test database.
- Application use cases with real repositories.
- Framework: Vitest + test database.

### E2E Tests (minimal)
- Critical user flows only: registration, login, start workout, complete workout.
- Framework: Playwright.

### Rules
- Test behavior, not implementation.
- Do not test React rendering details.
- Do not test third-party libraries.
- Every domain service must have unit tests.
- Every use case must have unit tests.
- Update tests when behavior changes.

---

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files (components) | PascalCase | `WorkoutCard.tsx` |
| Files (non-component) | kebab-case | `progressive-overload.ts` |
| React components | PascalCase | `WorkoutCard` |
| Hooks | camelCase with `use` prefix | `useWorkoutTimer` |
| Functions | camelCase, verb-first | `calculateNextWeight` |
| Domain entities | PascalCase | `WorkoutSession` |
| Value objects | PascalCase | `RepScheme` |
| Enums (const objects) | PascalCase | `EquipmentType` |
| DTOs | PascalCase with `Dto` suffix | `CreateWorkoutDto` |
| Zod schemas | camelCase with `Schema` suffix | `createWorkoutSchema` |
| Repositories | PascalCase with `Repository` suffix | `WorkoutSessionRepository` |
| Use cases | PascalCase with `UseCase` suffix or verb phrase | `CompleteWorkoutUseCase` |
| Server Actions | camelCase, verb-first | `completeWorkout` |
| DB tables | snake_case, plural | `workout_sessions` |
| DB columns | snake_case | `created_at` |
| Test files | `*.test.ts` / `*.spec.ts` | `progressive-overload.test.ts` |

---

## Import & Dependency Rules

### Allowed dependency direction:
```
app/ features/ → application/ → domain/
app/ features/ → infrastructure/ (only via ports/DI)
infrastructure/ → domain/, application/ (ports)
components/ → lib/ (utilities only)
```

### Forbidden:
- ❌ `domain/` importing from any other `src/` directory
- ❌ `application/` importing from `infrastructure/`, `app/`, `features/`
- ❌ `infrastructure/` importing from `app/`, `features/`
- ❌ Circular imports between any modules
- ❌ `components/ui/` importing from `features/` or `domain/`

### Import style:
- Use absolute imports via `@/` alias: `import { calculateVolume } from '@/domain/services/volume'`
- Use `import type` for type-only imports.
- Group imports: external → internal → relative.

---

## AI Coding Agent Rules

**These rules are mandatory for all AI agents working in this repository.**

### Before Making Changes
1. **Read existing code first.** Understand the current patterns before modifying anything.
2. **Search the repository** before creating a new utility, component, or helper. It may already exist.
3. **Check `docs/`** for architectural guidance relevant to your task.

### While Making Changes
4. **Follow established patterns.** Do not invent new architectural patterns.
5. **Do not introduce new libraries** without explicit justification and approval.
6. **Do not create generic abstractions prematurely.** Solve the specific problem first.
7. **Do not create files over ~200 lines.** Split into focused modules.
8. **Do not create React components over ~150 lines.** Extract sub-components.
9. **Preserve type safety.** Never introduce `any`, `as any`, or `@ts-ignore`.
10. **Keep server/client boundaries intentional.** Do not accidentally make a Server Component into a Client Component.
11. **Prefer small, coherent changes.** One logical change per commit.
12. **Reuse existing components and utilities.** Check `src/components/` and `src/lib/` first.

### After Making Changes
13. **Run type checking:** `npx tsc --noEmit`
14. **Run linting:** `npm run lint`
15. **Run relevant tests:** `npm test` or specific test files.
16. **Update tests** when business behavior changes.

### Forbidden Actions
- ❌ Silently changing the architecture or directory structure.
- ❌ Replacing existing libraries without documented justification.
- ❌ Deleting working behavior to simplify a task.
- ❌ Adding business logic to React components.
- ❌ Adding `"use client"` to layouts or high-level components.
- ❌ Importing Drizzle/ORM in React components.
- ❌ Creating duplicate shadcn/ui components.
- ❌ Modifying `src/components/ui/` with feature-specific logic.

### If Architecture Change Is Needed
- **Stop. Explain why.** Describe the problem, the proposed change, and the impact.
- Do NOT proceed with a broad refactor without explicit approval.
- Prefer incremental changes over big-bang rewrites.

---

## File Size & Complexity Limits

- Maximum file size: ~200 lines (guideline, not hard limit).
- Maximum React component size: ~150 lines.
- Maximum function size: ~40 lines.
- If a file or function exceeds these, split it.

---

## Git Conventions

- Commit messages: conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Branch naming: `feat/short-description`, `fix/short-description`.
- Small, focused commits. One logical change per commit.

---

## References

- `docs/architecture.md` — Full architecture documentation
- `docs/domain-modeling.md` — Domain modeling rules
- `docs/coding-conventions.md` — TypeScript, React, Next.js conventions
- `docs/database.md` — Database and persistence rules
- `docs/testing.md` — Testing strategy
- `docs/error-handling.md` — Error handling approach