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
    // Facts are read through the read-only port, never written here.
    expect(code).toContain('notPerformedRepository.listByEnrollment(');
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

  it('reads the facts through the read-only port and never a write authority', () => {
    const code = codeOf(CLOSURE_READ);

    expect(code).toContain('notPerformedRepository.listByEnrollment(');
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
      /new GetRunClosureSummaryUseCase\(\s*programEnrollmentRepository,\s*workoutSessionRepository,\s*notPerformedOccurrenceRepository,/,
    );
    expect(services).toMatch(
      /new RestartProgramUseCase\(\s*programRepository,\s*programEnrollmentRepository,\s*workoutSessionRepository,\s*notPerformedOccurrenceRepository,/,
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