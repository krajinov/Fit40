/**
 * M17 Slice 10 — architecture guards for run-closure wiring.
 *
 * Source-level rather than behavioural: the invariants are about WHICH Domain
 * authority each path calls and what may never change. Behaviour is locked by
 * `run-closure.test.ts` (Domain), `get-run-closure-summary.test.ts`,
 * `restart-program.test.ts`, `program-progress.test.ts` and the M14 suites.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const PROGRAM_PROGRESS = 'src/domain/services/program-progress.ts';
const CLOSURE_READ = 'src/application/use-cases/get-run-closure-summary.ts';
const CLOSURE_DTO = 'src/application/dto/run-closure.ts';
const RESTART = 'src/application/use-cases/restart-program.ts';
const COMPLETION_SUMMARY = 'src/application/use-cases/get-program-completion-summary.ts';
const COMPLETED_PAGE = 'src/app/(app)/programs/[programSlug]/completed/page.tsx';
const PROGRAM_DETAIL_PAGE = 'src/app/(app)/programs/[programSlug]/page.tsx';
const PROGRAM_DETAIL = 'src/features/programs/components/ProgramDetail.tsx';
const ENROLLMENT_SERVICES = 'src/features/enrollment/services.ts';
const ENROLLMENTS_SCHEMA = 'src/infrastructure/database/schema/enrollments.ts';
const MIGRATIONS_DIR = 'src/infrastructure/database/migrations';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

describe('M17 Slice 10 — the M14 completion authority is untouched', () => {
  it('pins isProgramComplete byte-identical', () => {
    const source = read(PROGRAM_PROGRESS);
    const start = source.indexOf('export function isProgramComplete(');
    expect(start).toBeGreaterThan(0);
    const end = source.indexOf('\n}', start);
    const implementation = source.slice(start, end + 2);

    expect(implementation).toBe(`export function isProgramComplete(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): boolean {
  const progress = calculateProgramProgress(program, completedIds);
  return progress.totalWorkouts > 0 && progress.remainingWorkouts === 0;
}`);
    // Conclusion is a separate module: completion never learns about a record.
    expect(codeOf(PROGRAM_PROGRESS)).not.toContain('not-performed');
    expect(codeOf(PROGRAM_PROGRESS)).not.toContain('isRunConcluded');
  });

  it('keeps the completion read and the /completed route free of every closure authority', () => {
    for (const file of [COMPLETION_SUMMARY, COMPLETED_PAGE]) {
      const code = codeOf(file);

      expect(code, `${file} references a closure authority`).not.toContain('isRunConcluded');
      expect(code).not.toContain('isRunRestartable');
      expect(code).not.toContain('resolveRunClosure');
      expect(code).not.toContain('RunClosure');
      expect(code).not.toContain('NotPerformedOccurrence');
      expect(code).not.toContain('getRunClosureSummaryUseCase');
    }
  });

  it('asks only the M14 summary use case for the completion route', () => {
    const code = codeOf(COMPLETED_PAGE);

    expect(code).toContain('getProgramCompletionSummaryUseCase');
    expect(code).not.toContain('getRunClosureSummaryUseCase');
  });
});

describe('M17 Slice 10 — the restart gate delegates to the Domain', () => {
  it('calls isRunRestartable exactly once and never rewrites the rule locally', () => {
    const code = codeOf(RESTART);

    expect(code).toContain('isRunRestartable({');
    expect(code).toContain('isRunConcluded(');
    expect(code).toContain('isProgramComplete(');
    // One delegation, not a hand-rolled policy.
    expect(code.match(/isRunRestartable\(/g)).toHaveLength(1);
    // No duplicated `complete || concluded`, no local conclusion arithmetic.
    expect(code).not.toContain('programComplete ||');
    expect(code).not.toContain('|| isRunConcluded');
    expect(code).not.toContain('openWorkouts === 0');
    expect(code).not.toContain('totalWorkouts > 0');
    expect(code).not.toContain('settledWorkouts');
  });

  it('uses the same widened rule at the gate and at the stale re-check', () => {
    const code = codeOf(RESTART);

    // One definition (the gate) plus two call sites: the pre-write gate and the
    // read-only re-check of a lost CAS.
    expect(code.match(/isEnrollmentRestartable\(/g)).toHaveLength(3);
    expect(code).not.toContain('isEnrollmentComplete(');
  });

  it('keeps the single compare-and-replace write and no second persistence path', () => {
    const code = codeOf(RESTART);

    expect(code.match(/replaceExpectedWithNew\(/g)).toHaveLength(1);
    expect(code).not.toContain('transaction(');
    expect(code).not.toContain('insert(');
    expect(code).not.toContain('delete(');
    expect(code).not.toContain('drizzle');
    // The preflight reads ONE coherent snapshot — the closure-facts projection
    // — and never two independently mutable settlement reads.
    expect(code).toContain('closureFactsRepository.listClosureFactsByEnrollment(');
    expect(code).not.toContain('notPerformedRepository');
    expect(code).not.toContain('listCompletedScheduledWorkoutIds(');
    expect(code).not.toContain('runOccurrenceWrites');
    expect(code).not.toContain('recordNotPerformed(');
    expect(code).not.toContain('undoNotPerformed(');
    // The existing error vocabulary is unchanged: no new code was introduced.
    expect(code).toContain("'PROGRAM_NOT_COMPLETE'");
    expect(code).not.toContain("'RUN_NOT_CONCLUDED'");
  });
});

describe('M17 Slice 10 — the closure read delegates and stays calendar-free', () => {
  it('resolves closure through the Domain authority, once', () => {
    const code = codeOf(CLOSURE_READ);

    expect(code).toContain('resolveRunClosure(');
    expect(code.match(/resolveRunClosure\(/g)).toHaveLength(1);
    // Both verdicts, and the one rule composed from them.
    expect(code).toContain('isProgramComplete(');
    expect(code).toContain('isRunRestartable({');
  });

  it('never inspects planned rows, dates or the M16 report', () => {
    const code = codeOf(CLOSURE_READ);

    expect(code).not.toContain('PlannedWorkout');
    expect(code).not.toContain('plannedDate');
    expect(code).not.toContain('planned_workouts');
    // No clock: conclusion is never a date consequence.
    expect(code).not.toContain('new Date(');
    expect(code).not.toMatch(/\bnow\b\s*:/);
    // M16's windowed report is a different read with a different denominator.
    expect(code).not.toContain('FollowThrough');
    expect(code).not.toContain('FOLLOW_THROUGH');
    expect(code).not.toContain('listRecentTrainingWeekWindows');
    expect(code).not.toContain('summarizeFollowThrough');
    expect(code).not.toContain('weekStart');
  });

  it('reads ONE snapshot through the closure-facts port and never a write authority', () => {
    const code = codeOf(CLOSURE_READ);

    // ONE coherent projection supplies both fact sets: two independent reads
    // could observe different database instants and manufacture a
    // completed+not-performed overlap the persisted state never held.
    expect(code).toContain('closureFactsRepository.listClosureFactsByEnrollment(');
    expect(code).not.toContain('Promise.all(');
    expect(code).not.toContain('listCompletedScheduledWorkoutIds(');
    expect(code).not.toContain('notPerformedRepository');
    expect(code).not.toContain('RunOccurrenceWriteRepository');
    expect(code).not.toContain('runOccurrenceWrites');
    expect(code).not.toContain('recordNotPerformed');
    expect(code).not.toContain('undoNotPerformed');
    expect(code).not.toContain('insert(');
    expect(code).not.toContain('transaction(');
    expect(code).not.toContain('drizzle');
  });

  it('carries counts and verdicts only — no percentage, date or calendar field', () => {
    const dto = codeOf(CLOSURE_DTO);

    for (const field of [
      'readonly totalWorkouts: number;',
      'readonly completedWorkouts: number;',
      'readonly notPerformedWorkouts: number;',
      'readonly openWorkouts: number;',
      'readonly isConcluded: boolean;',
      'readonly isProgramComplete: boolean;',
      'readonly restartAvailable: boolean;',
    ]) {
      expect(dto, `DTO is missing ${field}`).toContain(field);
    }
    expect(dto).not.toContain('percentage');
    expect(dto).not.toContain('plannedDate');
    expect(dto).not.toContain('recordedAt');
    expect(dto).not.toContain('notPerformedUnplaced');
  });
});

describe('M17 Slice 10 — program detail loads and EXPOSES the summary only', () => {
  it('reads the summary through the composed use case and hands it to the view', () => {
    const code = codeOf(PROGRAM_DETAIL_PAGE);

    expect(code).toContain('getRunClosureSummaryUseCase');
    expect(code).toContain('runClosure={runClosure}');
    // The same composition root the other enrollment reads use — no repository
    // is reachable from the page.
    expect(code).toContain("from '@/features/enrollment/services'");
    expect(code).not.toContain('infrastructure/database/repositories');
  });

  it('hands the summary to the panel as composition only — Slice 11 owns the states', () => {
    const code = codeOf(PROGRAM_DETAIL);

    // The prop exists on the interface and is passed straight through; this
    // component interprets no verdict and derives no gate from it.
    expect(code).toContain('readonly runClosure: RunClosureSummaryDto | null;');
    expect(code).toContain('runClosure={runClosure}');
    expect(code).not.toContain('isConcluded');
    expect(code).not.toContain('isProgramComplete');
    expect(code).not.toContain('restartAvailable');
    expect(code).not.toContain('resolveEnrolledPanelState');
  });

  it('wires the read-only fact port into both the closure read and the restart gate', () => {
    // Whitespace-normalized so the assertion is about the arguments, not the
    // formatter's line breaks.
    const services = codeOf(ENROLLMENT_SERVICES).replace(/\s+/g, ' ');

    expect(services).toMatch(
      /new GetRunClosureSummaryUseCase\(\s*programEnrollmentRepository,\s*runClosureFactsRepository,/,
    );
    expect(services).toMatch(
      /new RestartProgramUseCase\(\s*programRepository,\s*programEnrollmentRepository,\s*runClosureFactsRepository,/,
    );
    // Never the mutation authority in a read model or the eligibility gate.
    expect(services).not.toContain('new RunOccurrenceWrites');
  });
});

describe('M17 Slice 10 — no persisted run-closure state exists', () => {
  it('adds no closure column to the enrollment schema', () => {
    const schema = codeOf(ENROLLMENTS_SCHEMA);

    expect(schema).not.toContain('concluded');
    expect(schema).not.toContain('closedAt');
    expect(schema).not.toContain('closure');
    expect(schema).not.toContain('restart');
  });

  it('adds no migration that persists a lifecycle status or date', () => {
    const migrations = readdirSync(path.join(ROOT, MIGRATIONS_DIR)).filter((file) =>
      file.endsWith('.sql'),
    );
    expect(migrations.length).toBeGreaterThan(0);

    for (const file of migrations) {
      const sql = readFileSync(path.join(ROOT, MIGRATIONS_DIR, file), 'utf8');
      expect(sql, `${file} persists run closure`).not.toMatch(
        /concluded_at|closed_at|closure_status|run_status/i,
      );
    }
  });
});

describe('M17 Slice 13 — no run archive or enrollment-history table exists', () => {
  const SCHEMA_BARREL = 'src/infrastructure/database/schema/index.ts';

  it('creates no archive- or history-named table in any migration', () => {
    const migrations = readdirSync(path.join(ROOT, MIGRATIONS_DIR)).filter((file) =>
      file.endsWith('.sql'),
    );
    expect(migrations.length).toBeGreaterThan(0);

    const tables: string[] = [];
    for (const file of migrations) {
      const sql = readFileSync(path.join(ROOT, MIGRATIONS_DIR, file), 'utf8');
      for (const match of sql.matchAll(/CREATE TABLE "([^"]+)"/g)) {
        const table = match[1];
        if (table !== undefined) {
          tables.push(table);
        }
      }
    }

    // Every persisted table is live state — a pre-restart run's truth is
    // deliberately unrecoverable, never archived.
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => /archive|history/i.test(table))).toEqual([]);
    // The settlement fact is run-scoped live state, not an archive of anything.
    expect(tables).toContain('not_performed_workouts');
  });

  it('exports no archive-like table from the schema barrel', () => {
    expect(codeOf(SCHEMA_BARREL)).not.toMatch(/archive|history/i);
  });
});

describe('M17 — composed run-level reads are fenced by ProgramEnrollmentId', () => {
  it('the fenced path is ONE atomic projection - never a by-id check plus a facts read', () => {
    const code = codeOf(CLOSURE_READ);

    expect(code).toContain('expectedEnrollmentId?: string;');
    expect(code).toContain('summarizeFenced(');
    expect(code).toContain("code: 'ENROLLMENT_CHANGED'");
    expect(code).toContain('findFencedClosureFactsByEnrollment(');
    // The fenced path must NOT compose two mutable reads: no by-identity
    // enrollment lookup, and no independent facts read beside the projection.
    expect(code).not.toContain('findById(');
    expect(code.match(/listClosureFactsByEnrollment\(/g)).toHaveLength(1);
    // That single remaining facts read is the STANDALONE path's (guarded by the
    // current-enrollment resolution, which happens exactly once).
    expect(code.match(/findByUserAndProgram\(/g)).toHaveLength(1);
    expect(code).toContain('resolveCurrentEnrollment(');
  });

  it('the fenced projection is ONE statement anchored on the enrollment row', () => {
    const adapter = codeOf('src/infrastructure/database/repositories/drizzle-run-closure-facts-repository.ts');
    const fenced = adapter.slice(adapter.indexOf('async findFencedClosureFactsByEnrollment('));

    // ONE statement: the anchor row (the expected enrollment, verified against
    // the trusted user + program in the SAME predicate) UNION ALL the facts.
    expect(fenced.match(/await /g)).toHaveLength(1);
    expect(fenced.match(/\.unionAll\(/g)).toHaveLength(2);
    expect(fenced).toContain('programEnrollments');
    expect(fenced).toContain('programEnrollments.userId');
    expect(fenced).toContain('programEnrollments.programId');
    // The explicit not-matched answer, never a matched-but-empty fact set.
    expect(fenced).toContain('matched: false');
    // Read-only: no transaction, no lock, no write, no SERIALIZABLE.
    expect(fenced).not.toContain('transaction(');
    expect(fenced).not.toContain(".for('");
    expect(fenced).not.toContain('insert(');
    expect(fenced).not.toContain('update(');
    expect(fenced).not.toContain('delete(');
    expect(fenced.toLowerCase()).not.toContain('serializable');
  });

  it('exposes no by-identity enrollment read for Composition to misuse', () => {
    // The fenced projection OWNS the identity check, so the enrollment port
    // deliberately offers no `findById` for a use case to pair with a facts
    // read; the two-call composition is structurally impossible.
    expect(codeOf('src/application/ports/program-enrollment-repository.ts')).not.toContain('findById(');
  });

  it('the dashboard fences the closure read to the enrollment it already loaded', () => {
    const code = codeOf('src/application/use-cases/get-current-program-dashboard.ts');

    expect(code).toContain('expectedEnrollmentId');
    expect(code).toContain('enrollment.enrollmentId');
    // The typed refusal degrades to NO closure data, never a fabricated summary.
    expect(code).not.toContain('resolveCurrentEnrollment');
  });

  it('program detail fences the closure read the same way', () => {
    const code = codeOf('src/app/(app)/programs/[programSlug]/page.tsx');

    expect(code).toContain('expectedEnrollmentId');
    expect(code).toContain('enrollment.enrollmentId');
  });

  it('exposes the loaded enrollment id for fencing through the enrollment view DTO', () => {
    const dto = codeOf('src/application/dto/enrollment.ts');
    const read = codeOf('src/application/use-cases/get-program-enrollment.ts');

    expect(dto).toContain('readonly enrollmentId: string;');
    expect(read).toContain('enrollmentId: enrollment.id');
  });
});

describe('M17 closure projection — one snapshot read owns both fact sets', () => {
  const PORT = 'src/application/ports/run-closure-facts-repository.ts';
  const ADAPTER =
    'src/infrastructure/database/repositories/drizzle-run-closure-facts-repository.ts';

  it('declares two snapshot reads returning the fact sets, and no mutation surface', () => {
    const port = codeOf(PORT);

    // Both are ONE-snapshot reads of the same facts: the enrollment-scoped
    // projection and the fenced variant that also establishes the expected
    // enrollment in the SAME statement.
    expect(port).toContain(
      'listClosureFactsByEnrollment(enrollmentId: EnrollmentId): Promise<RunClosureFacts>;',
    );
    expect(port).toContain('expectedEnrollmentId: EnrollmentId,');
    expect(port).toContain('): Promise<FencedRunClosureFacts>;');
    expect(port.match(/Promise</g)).toHaveLength(2);
    // Read-only by construction: a read model never changes the fact it reports.
    expect(port).not.toContain('recordNotPerformed');
    expect(port).not.toContain('undoNotPerformed');
    expect(port).not.toContain('insert');
    expect(port).not.toContain('delete');
  });

  it('projects both sets with ONE statement — no second statement, no transaction, no lock', () => {
    const adapter = codeOf(ADAPTER);

    // Each read is ONE statement (a UNION of both projections) taking ONE READ
    // COMMITTED snapshot, so the two sets can never be torn across concurrent
    // commits — and the fenced read additionally pins the enrollment identity
    // in that same statement.
    expect(adapter.match(/\.unionAll\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(adapter.match(/await /g)).toHaveLength(2);
    // A read-only projection never serializes behind a transaction or lock.
    expect(adapter).not.toContain('transaction(');
    expect(adapter).not.toContain(".for('");
    expect(adapter).not.toContain('insert(');
    expect(adapter).not.toContain('update(');
    expect(adapter).not.toContain('delete(');
    expect(adapter.toLowerCase()).not.toContain('repeatable');
  });

  it('wires the projection into the closure read and the restart preflight only', () => {
    const services = codeOf(ENROLLMENT_SERVICES);

    // The closure read AND the restart preflight share the one-snapshot
    // projection; nothing else may reach it.
    expect(services).toContain('runClosureFactsRepository');
    expect(services.match(/runClosureFactsRepository/g)).toHaveLength(3);
  });
});

describe('M17 final review — restartability is revalidated under the replacement authority', () => {
  const PORT = 'src/application/ports/program-enrollment-repository.ts';
  const DRIZZLE_REPO =
    'src/infrastructure/database/repositories/drizzle-program-enrollment-repository.ts';

  it('requires the replacement to be authorized by a restartability decision over locked facts', () => {
    const port = codeOf(PORT);

    // The primitive takes the decision and the facts it is evaluated over…
    expect(port).toContain('isStillRestartable: RestartabilityDecision,');
    expect(port).toContain('notPerformedIds: ReadonlyArray<ScheduledWorkoutId>;');
    // …and can refuse specifically on restartability.
    expect(port).toContain("readonly kind: 'not-restartable'");
  });

  it('locks the expected enrollment, reads the CURRENT facts, decides, and only then deletes', () => {
    const full = codeOf(DRIZZLE_REPO);
    // Scope to the replacement method itself: the class also has a plain
    // `delete` method earlier in the file.
    const code = full.slice(full.indexOf('async replaceExpectedWithNew('));
    const lock = code.indexOf(".for('no key update')");
    const completedRead = code.indexOf('workoutSessions.scheduledWorkoutId');
    const factRead = code.indexOf('notPerformedWorkouts.scheduledWorkoutId');
    const decision = code.indexOf('isStillRestartable({');
    const del = code.indexOf('.delete(programEnrollments)');

    expect(lock).toBeGreaterThan(0);
    // Facts are read UNDER the lock…
    expect(completedRead).toBeGreaterThan(lock);
    expect(factRead).toBeGreaterThan(lock);
    expect(decision).toBeGreaterThan(completedRead);
    expect(decision).toBeGreaterThan(factRead);
    // …and the delete happens ONLY after the decision.
    expect(del).toBeGreaterThan(decision);
  });

  it('refuses with ZERO writes when the decision fails (the refusal returns before any delete)', () => {
    const full = codeOf(DRIZZLE_REPO);
    const code = full.slice(full.indexOf('async replaceExpectedWithNew('));
    const refuse = code.indexOf("return { kind: 'not-restartable' }");
    const del = code.indexOf('.delete(programEnrollments)');

    expect(refuse).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(refuse);
  });

  it('adds no retry loop, no advisory lock and no SERIALIZABLE requirement', () => {
    const repo = codeOf(DRIZZLE_REPO).toLowerCase();
    const useCase = codeOf(RESTART);

    expect(repo).not.toContain('advisory');
    expect(repo).not.toContain('serializable');
    expect(useCase.toLowerCase()).not.toContain('advisory');
    expect(useCase.toLowerCase()).not.toContain('serializable');
    // No retry loop wraps the replacement.
    expect(useCase).not.toContain('while (');
    expect(useCase).not.toContain('for (');
  });

  it('maps the locked refusal to the existing PROGRAM_NOT_COMPLETE and passes the SAME Domain rule', () => {
    const useCase = codeOf(RESTART);

    expect(useCase).toContain("outcome.kind === 'not-restartable'");
    expect(useCase).toContain('programNotComplete(program.slug)');
    // The decision handed to the write is the shared Domain composition, never
    // a constant or a second formula.
    expect(useCase).toContain('(facts) => this.isRestartable(program, facts)');
    expect(useCase).not.toContain('complete || concluded');
  });
});