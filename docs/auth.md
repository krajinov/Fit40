# Authentication & User Identity

This document describes the minimal auth slice implemented for Fit40.

## Strategy

- **Custom credentials**, not Auth.js/Clerk. This keeps provider-specific code
  out of the application layer and keeps local development/CI simple.
- **Email + password** for the MVP. OAuth and passwordless are deferred.
- **Database sessions** with opaque bearer tokens. The database stores only the
  SHA-256 hash of the token, so a DB leak does not expose usable sessions.
  Database sessions allow revocation, multi-device support, and server-side
  authorization checks without JWT signing complexity.

## Session cookie

- Name: `fit40_session`
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production,
  30-day fixed expiry
- Next.js Server Actions perform their own origin checking, so no home-grown
  CSRF tokens are needed.

## Identity resolution

Server-side code should call `getCurrentUser()` or `requireUser()` from
`src/features/auth/current-user.ts`. These helpers read the session cookie and
**delegate** identity resolution to the application-layer
`GetCurrentUserUseCase`. The feature layer does not orchestrate repositories
directly.

Future ownership/enrollment features must derive `UserId` from `requireUser()`
on the server. Never trust a `userId` hidden form field or query parameter for
authorization.

## User model

`User` is intentionally minimal: `id`, `email`, `createdAt`. Fitness profile
fields (age, weight, goals, equipment, etc.) belong to later Profile/Onboarding
slices. The password hash is never part of a domain entity or DTO; it is
accessible only through the explicitly credential-shaped
`UserRepository.findCredentialsByEmail` method.

## Email normalization

Email addresses are trimmed and lowercased in the `EmailAddress` value object
and again at the Zod boundary. The database enforces canonical storage as the
final authority with:

- `UNIQUE` constraint on `users.email`
- `CHECK (email = lower(email))`
- `CHECK (email <> '')`

This prevents `User@Example.com` and `user@example.com` from becoming
accidental duplicates.

## Passwords

Passwords are hashed with **argon2id** via `@node-rs/argon2` using the OWASP
recommended defaults. Plaintext passwords are never stored, logged, or returned
in DTOs. Verification is timing-safe inside the library. Login failures are
deliberately generic (`INVALID_CREDENTIALS`) and a dummy verification runs for
unknown emails to equalize timing.

## Protected routes

Only `/dashboard` is protected in this slice. Public catalog routes
(`/exercises`, `/programs`) remain open. Workout-session routes and actions are
**unchanged**; authentication + `WorkoutSession.userId` ownership will be
introduced together in the later Enrollment/Ownership slice.

## Registration duplicate race

Registration performs a friendly preflight `findByEmail` check, but the
`UNIQUE` constraint is the final authority. A concurrent race that races the
preflight is caught by translating PostgreSQL unique-violation error `23505`
to `EmailAlreadyExistsError`, then to the `EMAIL_ALREADY_EXISTS` action result.

## Rate limiting

No distributed rate limiting is implemented in this slice. Argon2 verification
provides moderate brute-force slowdown; real protection is deferred to the
deployment edge (reverse proxy/WAF).

## Deferred work

- Email verification
- Password reset
- OAuth / social login
- Sliding session renewal
- Session/device management UI
- Program enrollment and WorkoutSession ownership
- User fitness profile / onboarding
- Admin/RBAC
