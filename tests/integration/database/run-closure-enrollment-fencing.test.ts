/**
 * M17 enrollment identity fencing — composed run-level reads describe ONE
 * enrollment generation, on real PostgreSQL.
 *
 * The P2 finding this suite guards: the dashboard and Program Detail loaded
 * an enrollment (A) and then let the closure read re-resolve the CURRENT
 * enrollment, so a concurrent restart (or leave/rejoin) could compose the
 * parent view's A data with the NEW run's closure facts. The fix: the closure
 * read is fenced to the caller's expected enrollment identity — the dashboard
 * and program detail pass the id of the enrollment they already loaded — and a
 * vanished or replaced expected enrollment yields the typed
 * `ENROLLMENT_CHANGED` refusal instead of a silent switch.
 *
 * The interleaving here is the tear window itself, executed sequentially and
 * deterministically (the parent's reads happened, the replacement happened,
 * the closure read happens): no gate or sleep is needed to place the closure
 * read after the replacement, and the fencing makes the outcome exact.
 *
 * The dashboard and Program Detail compose the SAME closure use case and pass
 * the SAME expected id (their wiring is pinned by the unit and architecture
 * guards); this suite proves the fenced read contract on the real database.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetProgramEnrollmentUseCase } from '@/application/use-cases/get-program-enrollment';
import { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';

import { seedConcludedRun, type ConcludedRunFixture } from './not-performed-race-fixtures';
import { closeDatabase, programEnrollmentRepository, programRepository, resetAndSeed, runClosureFactsRepository, workoutSessionRepository } from './setup';

const OWNER = 'm17-fencing-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-fencing-a';

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** A RESTARTABLE run: every authored occurrence completed except the last, recorded N. */
async function seedRestartableRun(): Promise<ConcludedRunFixture> {
  return seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
}

describe('M17 enrollment identity fencing — the closure read composes one generation', () => {
  it('3. refuses with ENROLLMENT_CHANGED when restart replaced the loaded enrollment, instead of switching to the new run', async () => {
    const seeded = await seedRestartableRun();
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error(`seed program "${PROGRAM_SLUG}" is missing`);

    const getProgramEnrollment = new GetProgramEnrollmentUseCase(
      programEnrollmentRepository,
      workoutSessionRepository,
    );
    const restart = new RestartProgramUseCase(
      programRepository,
      programEnrollmentRepository,
      runClosureFactsRepository,
      new NodeIdGenerator(),
    );
    const closure = new GetRunClosureSummaryUseCase(programEnrollmentRepository, runClosureFactsRepository);

    // 1. The parent (dashboard / program detail) loads the run's view.
    const view = await getProgramEnrollment.execute({ userId: OWNER, program });
    expect(view.ok).toBe(true);
    if (!view.ok || view.data.status !== 'enrolled') throw new Error('expected an enrolled view');
    const expectedEnrollmentId = view.data.enrollmentId;
    expect(expectedEnrollmentId).toBe(seeded.enrollmentId);

    // 2. A concurrent restart replaces the enrollment with a fresh run.
    const replaced = await restart.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(replaced.ok).toBe(true);

    // 3. The fenced closure read executes for the EXPECTED enrollment.
    const fenced = await closure.execute({
      userId: OWNER,
      program,
      expectedEnrollmentId,
    });

    // The typed refusal: the caller is composing an old-enrollment view, and
    // the fenced read NEVER silently describes the replacement run instead.
    expect(fenced.ok).toBe(false);
    if (fenced.ok) return;
    expect(fenced.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });

    // The retired composition (no expected id) DID switch: the same read
    // without the fence describes the replacement run — the cross-generation
    // mix the fencing removes.
    const unfenced = await closure.execute({ userId: OWNER, program });
    expect(unfenced.ok).toBe(true);
    if (!unfenced.ok || unfenced.data === null) throw new Error('expected the replacement run');
    const mixedGenerationClosure: RunClosureSummaryDto = unfenced.data;
    expect(mixedGenerationClosure.completedWorkouts).toBe(0);
    expect(mixedGenerationClosure.isConcluded).toBe(false);
  });

  it('refuses the same way when a leave deleted the loaded enrollment', async () => {
    const run = await seedRestartableRun();
    void run;
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error(`seed program "${PROGRAM_SLUG}" is missing`);

    const closure = new GetRunClosureSummaryUseCase(programEnrollmentRepository, runClosureFactsRepository);
    const leave = new LeaveProgramUseCase(programRepository, programEnrollmentRepository);

    // The parent loaded the run; a concurrent leave deleted it mid-composition.
    const left = await leave.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(left.ok).toBe(true);

    const fenced = await closure.execute({
      userId: OWNER,
      program,
      expectedEnrollmentId: run.enrollmentId,
    });

    // Deterministic and typed: a vanished expected enrollment is the SAME
    // refusal, never a fabricated summary and never another run's facts.
    expect(fenced.ok).toBe(false);
    if (fenced.ok) return;
    expect(fenced.error).toMatchObject({ code: 'ENROLLMENT_CHANGED' });
  });

  it('still describes the expected enrollment exactly while it is current', async () => {
    const run = await seedRestartableRun();
    const program = await programRepository.findBySlug(PROGRAM_SLUG);
    if (program === null) throw new Error(`seed program "${PROGRAM_SLUG}" is missing`);

    const closure = new GetRunClosureSummaryUseCase(programEnrollmentRepository, runClosureFactsRepository);

    const fenced = await closure.execute({
      userId: OWNER,
      program,
      expectedEnrollmentId: run.enrollmentId,
    });

    expect(fenced.ok).toBe(true);
    if (!fenced.ok || fenced.data === null) throw new Error('expected the loaded run');
    expect(fenced.data.completedWorkouts).toBe(11);
    expect(fenced.data.notPerformedWorkouts).toBe(1);
    expect(fenced.data.isConcluded).toBe(true);
  });
});
