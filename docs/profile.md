# User Profile & Onboarding

This document describes the profile/onboarding slice that follows the
Authentication & User Identity slice.

## Separation of identity and profile

The auth `User` entity remains intentionally minimal (`id`, `email`,
`createdAt`). All fitness context lives on a separate `UserProfile` entity
(`src/domain/entities/user-profile.ts`) associated 1:1 with a `UserId`:

- identity answers *who can sign in*;
- the profile answers *what training context does this person have*.

Fitness attributes must never be added to `User`. Profile persistence never
touches `users`, `auth_sessions`, or training-history tables, so editing a
profile cannot affect authentication or workout history.

## Age representation and constraint

- **Birth year, not date of birth.** No domain rule requires day precision:
  Fit40 needs the age band a user belongs to, and a year is the minimal
  personal data that provides it (data minimization). Age is derived with
  `approximateAgeInYears`, never persisted.
- **Age >= 18 at submission (upper bound 120).** Repository evidence:
  AGENTS.md and domain-modeling.md describe the platform as "for adults aged
  40+", and registration is open (no age gate). "40+" is positioning and
  program-design focus, not an access restriction: enforcing it at
  onboarding would permanently lock out already-registered younger users. The
  floor is 18 because every product statement says *adults*.

## Fields

| Field | Representation | Constraints |
|-------|----------------|-------------|
| `birthYear` | integer | age 18–120 at submission; DB lower bound `>= 1900` |
| `experienceLevel` | NEW `ExperienceLevel` enum | intentionally separate from exercise/program `Difficulty` though value sets coincide |
| `primaryGoal` | reused `ProgramGoal` | user goal matches program goals by design |
| `availableEquipment` | reused `EquipmentType`, `text[]` | >= 1, unique |
| `physicalConsiderations` | reused `PhysicalConsideration`, `text[]` | unique, empty = none (no free-text medical data) |
| `preferredDaysPerWeek` | integer | 1–7 |
| `preferredSessionMinutes` | integer | 10–240 |
| `heightCm` | integer or null | 100–250 |
| `weightKg` | canonical kg `numeric(5,2)` | 30–400 (domain); DB safety net 30–500; lb converted at the Zod boundary |
| `createdAt` / `updatedAt` | `timestamptz` | `updated_at >= created_at` |

There is no `onboardingCompleted` flag: the absence of a `profiles` row IS the
"not onboarded" state.

## Persistence

Table `profiles` (migration `0003`, forward-only):

- `user_id` is the PRIMARY KEY (exactly one profile per user — the final
  authority for the double-submit race) and a CASCADE FK to `users.id`.
- Enum columns carry CHECK constraints; arrays carry subset, uniqueness
  (reusing `fit40_text_array_has_duplicates` from migration `0000`), and
  non-emptiness (equipment) checks.
- No extra indexes: the only access pattern is lookup by primary key.

Create/update are separate repository operations (no upsert). A create race
surfaces as `ProfileAlreadyExistsError` → `PROFILE_ALREADY_EXISTS`; an update
that matches no row returns `false` → `PROFILE_NOT_FOUND`. No optimistic
concurrency: one user edits their own profile.

## Routes and trust boundary

- `/onboarding` — `requireUser`; users with a profile are redirected to
  `/profile`; submitting creates the profile and redirects to `/dashboard`.
- `/profile` — `requireUser`; users without a profile are redirected to
  `/onboarding`; submitting updates the profile in place.
- `/dashboard` — redirects to `/onboarding` when no profile exists. This is
  the single profile-awareness point after login/registration; the auth
  redirect flow remains unchanged.
- All pages and both Server Actions call `requireUser()` themselves. The
  `UserId` used by the use cases comes exclusively from the authenticated
  session — a `userId` submitted in form data is ignored by design. No
  middleware is used.

## Forms

Native `<form>` + Server Actions + `useActionState`, matching the auth
pattern. Server-side Zod validation is authoritative; expected failures are
typed action state (`VALIDATION_ERROR`, `PROFILE_ALREADY_EXISTS`,
`PROFILE_NOT_FOUND`, `INVALID_PROFILE`) with submitted values preserved; on
save success `/profile` is revalidated and the form remounts keyed by
`updatedAt`. The weight unit selector (`kg`/`lb`) is presentation-only and
converted to canonical kilograms at the Zod boundary. No React Hook Form.

## Deferred work

Program enrollment, workout/history ownership, personalized program
generation/recommendations, weight history, unit preferences, sex field,
account deletion UI.
