# M19 Slice 5 — Exercise Catalog ↔ Personal History

## Implementation and boundaries

Based on latest `origin/main` at `6e392551` (S4, PR #27), on branch
`feat/m19-s5-exercise-history`. Scope is S5 only.

- Application: `GetExerciseHistoryPresenceUseCase` validates the trusted user ID
  before accessing either repository, resolves the slug, preserves
  `EXERCISE_NOT_FOUND`, and reads the resolved ExerciseId with
  `listCompletedExerciseOccurrences(userId, exerciseId, 1)`.
- DTO: `present`, `absent`, or `unavailable`; no metrics, counts or previews.
  Unavailable carries the original server-only diagnostic cause. Successful
  reads use the DTO mapper; rejected reads never become successful absence.
- Composition: existing exercise/history repositories are wired in the exercise
  feature's composition root. No new port, adapter, query, dependency, schema,
  table, migration, cache or persisted state.
- View assembly logs unavailable reads with `console.error`, including user,
  slug and original cause. It exposes `personalHistoryHref` only for `present`
  and never sends diagnostics to the component.
- The public route validates and resolves the exercise before authentication or
  personalization. Signed-out visitors never invoke the presence use case.
  Metadata remains public. No new streaming boundary or catch surrounds
  `notFound()` or authentication navigation.
- `ExerciseDetail` remains a Server Component with one optional href prop. It
  renders exactly one native contextual link, “View your history for this
  exercise”, with a 44px minimum target and visible focus styling. Its existing
  content/layout remain intact; no repository or infrastructure reaches it.

## Historical truth and ownership

The existing training-history repository remains the authority. Completed
sessions require at least one logged set on the addressed occurrence; skipped,
zero-set and in-progress occurrences do not establish presence. Detached
completed sessions remain eligible. All history reads use the authenticated
user's ID.

Substitution attribution follows the persisted performed ExerciseId. A completed
Romanian-deadlift occurrence performed as goblet squat establishes goblet-squat
presence and leaves Romanian-deadlift history absent. Neither authored identity
nor enrollment state introduces a second eligibility rule.

Unavailable history omits the link and keeps the public detail usable, while
retaining its diagnostic cause for server logging. Catalog lookup failures are
outside the optional history catch; unknown exercises preserve the existing
404 path. Expected validation/lookup errors are not logged as infrastructure
failures or represented as confirmed absence.

## TDD and verification

Tests were written before implementation. Initial runs failed for the missing
use-case/view modules, missing component link and missing page personalization.
The initial database run also failed on the missing use-case module, after
successfully reaching PostgreSQL.

| Check | Result |
|---|---|
| New use-case, view, component and page tests | 4 files / 25 tests passed |
| Relevant database integration tests | 3 files / 82 tests passed |
| Full unit suite (`npm test`) | 229 files / 3,100 tests passed |
| TypeScript (`npx tsc --noEmit`) | exit 0 |
| ESLint (`npm run lint`) | exit 0 |
| Production build (`npm run build -- --webpack`) | exit 0 |
| Full database integration suite (`npm run test:integration`) | 50 files / 500 tests passed |
| Production HTTP smoke checks | All six scenarios passed (see below) |
| `git diff --check` | clean |

Relevant database command:
`npm run test:integration -- tests/integration/database/exercise-history-presence.test.ts tests/integration/database/training-history-repository.test.ts tests/integration/database/exercise-history-markers.test.ts`.

Unit coverage checks invalid IDs without repository calls, unknown slugs,
present/absent/unavailable, original failure observability and view logging,
resolved exercise identity, exact limit 1, signed-out read suppression, all
authenticated states, public content, metadata, malformed/unknown 404 paths and
authentication sentinel propagation. Component tests inspect native links and
public content rather than Tailwind utilities.

The nine new PostgreSQL tests cover attached and detached completed history,
successful absence, replacement-only substitution attribution, skipped and
zero-set occurrences, in-progress sessions, another user's history, and bounded
statement count/set hydration. Existing history/marker tests remain passing.

The first full integration command was blocked by sandbox `EPERM` connecting to
local PostgreSQL; it was retried with database access. The production server's
first port bind was likewise restricted and retried with local server access.
No blocked command is counted as passing.

Production HTTP smoke checks used the webpack build on local port 3195 and the
dedicated `fit40_test` database, after the full integration suite finished:

| Scenario | HTTP status | Contextual history links |
|---|---|---|
| Signed out, goblet squat | 200 | 0 |
| Signed in, completed goblet-squat history | 200 | 1 |
| Signed in, glute bridge without history | 200 | 0 |
| Signed out, unknown slug | 404 | 0 |
| Signed in, unknown slug | 404 | 0 |
| Signed in, failed history read | 200 | 0 |

Every 200 response retained public detail content. To exercise a real history
failure without altering production code, a temporary external smoke script
renamed `set_logs` in the test database, requested the page, and restored the
table in `finally`. The public exercise/auth tables stayed available. The page
rendered with no personal link and the server logged the original database
failure through the presence view convention. No diagnostic appeared in the
response. The probe script lives outside the repository; no probe code or schema
change is included in the commit. A post-probe rerun of all nine presence
integration tests passed, confirming restored table access and history behavior.
Its initial sandbox-restricted attempt was retried with database access. The
temporary production server was stopped. These are HTTP checks, not browser
E2E tests.

## Query cost

Driver-observed statement counts, after warming type discovery:

| Presence | Statements for the use case |
|---|---|
| Absent | 2: slug lookup + occurrence selection |
| Present | 3: slug lookup + occurrence selection + batched set hydration |

The present count stays 3 with one and 21 historical occurrences. The hydration
parameter contains exactly one occurrence key. This is constant statement count,
with no N+1. The route also keeps its existing public exercise lookup; the
presence use case performs its own slug resolution as required. Authentication
and shell reads are outside these measured use-case counts.

The approved method hydrates all sets of the one selected occurrence. The
limit bounds occurrence hydration, not the historical table size examined by
the database or the number of sets within that occurrence. No latency benchmark
or production-scale query-plan claim is made. These findings provide no measured
reason to add a dedicated existence port/query.

## Limits and unchanged contracts

No real-browser responsive, keyboard-focus or screen-reader inspection was
performed for S5; jsdom assertions do not prove CSS geometry or visible focus.
Turbopack was not run for S5; only the requested webpack build is verified.

M8–M18 canonical contracts remain unchanged, including progression, prescription
snapshots, performed-exercise attribution, skipped/set-less eligibility,
detached-history survival, personal records, training history, closure and
Progress semantics. No Domain, Infrastructure or repository-port file changed.
S1–S4 behavior remains covered by the passing full unit suite. No S6 work,
push, PR or merge is included.
