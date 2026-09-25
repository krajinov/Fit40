/**
 * Use case: the truthful completion summary of the authenticated user's
 * CURRENT program enrollment (M14 Slice 4).
 *
 * Read-only. The `userId` must come from the trusted authenticated session at
 * the presentation layer, never from client input.
 *
 * Three authoritative outcomes:
 * - `ok(null)` — the user is not enrolled in this program (no session or
 *   record read is issued).
 * - `{ status: 'incomplete' }` — an enrollment exists but the run is not
 *   complete: the cheap path, built from the completed scheduled-workout id
 *   projection only (no session hydration, no record read, no catalog read).
 * - `{ status: 'completed' }` — the run is complete by the Domain's
 *   `isProgramComplete` rule, summarized from the run's own completed
 *   sessions.
 *
 * Semantics are never re-decided here. Completion is Slice 1's rule; the
 * completion instant is Slice 1's `resolveProgramCompletionDate`; progress
 * counts are the Domain's `calculateProgramProgress`; the run's sessions are
 * Slice 2's enrollment-scoped read; and the record events reuse M12's exact
 * pipeline unchanged:
 *
 *   run's completed sessions (enrollment-scoped read)
 *     -> extractRecordCandidates(session)             // Domain: eligibility + positions
 *     -> findBestValuesBefore(userId, candidates)     // exact best strictly before, user-global
 *     -> resolveRecordEvents(priorBests)              // Domain: first/strictly-greater only
 *
 * Candidate ORIGIN is enrollment-scoped (only this run's sessions contribute);
 * prior-best evaluation stays user-global (detached sessions, earlier runs and
 * other programs all count), so a "PR event during this run" means what was
 * true at that point in history — including events later surpassed.
 * `findCurrentPersonalBestsSetBetween` is deliberately NOT used: that is M13's
 * current/still-standing-best semantics and would answer a different question.
 */

import { toExerciseSummaryDto, type ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  selectNewestRecordEvents,
  toProgramCompletionCompletedDto,
  type ProgramCompletionSummaryDto,
} from '@/application/dto/program-completion';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { CompletedWorkoutSession } from '@/application/ports/training-history-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { extractRecordCandidates, resolveRecordEvents } from '@/domain/services/personal-records';
import {
  calculateProgramProgress,
  isProgramComplete,
  resolveProgramCompletionDate,
} from '@/domain/services/program-progress';
import { createUserId, type ExerciseId, type UserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetProgramCompletionSummaryError =
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string };

export interface GetProgramCompletionSummaryInput {
  readonly userId: string;
  readonly programSlug: string;
}

export class GetProgramCompletionSummaryUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly personalRecordRepository: PersonalRecordRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: GetProgramCompletionSummaryInput,
  ): Promise<Result<ProgramCompletionSummaryDto | null, GetProgramCompletionSummaryError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }
    const userId = userIdResult.data;

    const program = await this.programRepository.findBySlug(input.programSlug);
    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
      });
    }

    // Ownership: the enrollment is resolved through the (user, program) pair,
    // so one user can never summarize another user's run.
    const enrollment = await this.enrollmentRepository.findByUserAndProgram(userId, program.id);
    if (enrollment === null) {
      return ok(null);
    }

    // ── Cheap incomplete path ────────────────────────────────────────────────
    // Progress comes from the completed scheduled-workout id projection alone;
    // no session hydration, no record read and no catalog read are issued.
    const completedIds = await this.sessionRepository.listCompletedScheduledWorkoutIds(
      enrollment.id,
    );
    const progress = calculateProgramProgress(program, completedIds);
    if (!isProgramComplete(program, completedIds)) {
      return ok({
        status: 'incomplete',
        completedWorkouts: progress.completedWorkouts,
        totalWorkouts: progress.totalWorkouts,
      });
    }

    // ── Completed run ────────────────────────────────────────────────────────
    const sessions = await this.sessionRepository.listCompletedByEnrollment(enrollment.id);

    const completedAt = resolveProgramCompletionDate(
      program,
      sessions.map((session) => ({
        scheduledWorkoutId: session.scheduledWorkoutId,
        completedAt: session.completedAt,
      })),
    );
    if (completedAt === null) {
      // Unreachable: completion requires every scheduled workout to have a
      // completed session attached to this enrollment, so at least one
      // matching session exists. A miss is a contract violation, never a
      // silently absent date.
      throw new Error(
        `Completion summary contract violated: enrollment "${enrollment.id}" is complete but no completion date resolved`,
      );
    }

    const recordEvents = await this.resolveHistoricalRecordEvents(userId, sessions);

    // Catalog identity only for what can render: the capped display list,
    // deduplicated ids, ONE batched read — and none at all when nothing can
    // render. The exact count below is unaffected by resolution gaps.
    const displayEvents = selectNewestRecordEvents(recordEvents);
    const displayExerciseIds = [...new Set(displayEvents.map((event) => event.exerciseId))];
    const exercises: ReadonlyArray<ExerciseSummaryDto> =
      displayExerciseIds.length === 0
        ? []
        : (await this.exerciseRepository.findByIds(displayExerciseIds)).map(toExerciseSummaryDto);

    return ok(
      toProgramCompletionCompletedDto({
        programName: program.name,
        programSlug: program.slug,
        completedWorkouts: progress.completedWorkouts,
        totalWorkouts: progress.totalWorkouts,
        completedAt,
        distinctExercises: countDistinctTrainedExercises(sessions),
        recordEvents,
        exercises,
      }),
    );
  }

  /**
   * The run's HISTORICAL record events, exactly as M12 defines them.
   *
   * The enrollment read returns the run's completed sessions in ascending
   * `(completedAt, startedAt, id)` order and `extractRecordCandidates` returns
   * each session's candidates in ascending position order, so the combined
   * array is already in ascending `PerformancePosition` order — the order the
   * exact best-before projection and the resolver both preserve. Candidates
   * come only from this run's sessions; the best-before answer is user-global.
   */
  private async resolveHistoricalRecordEvents(
    userId: UserId,
    sessions: ReadonlyArray<CompletedWorkoutSession>,
  ) {
    const candidates: RecordCandidate[] = [];
    for (const session of sessions) {
      const extracted = extractRecordCandidates(session);
      if (!extracted.ok) {
        throw new Error(
          `Corrupt data in completed session (id=${session.id}): ${extracted.error.message}`,
        );
      }
      candidates.push(...extracted.data);
    }

    // A run whose logged sets are all set-less (every occurrence skipped or
    // empty) has no candidates: there is no record to look up, so the exact
    // best-before read is not issued at all.
    if (candidates.length === 0) return [];

    const priorBests = await this.personalRecordRepository.findBestValuesBefore(userId, candidates);
    return resolveRecordEvents(priorBests);
  }
}

/**
 * Distinct exercises actually TRAINED in the run: performed exercise ids of
 * occurrences carrying at least one logged set.
 *
 * Chosen definition (the repository-consistent reading of M12's history
 * semantics — "an occurrence with no logged sets contributes nothing"): a
 * skipped or otherwise set-less occurrence is not training, so it does not
 * count; a substituted occurrence counts as its PERFORMED (replacement)
 * exercise, never its authored one; a user-added occurrence counts like any
 * other. Nothing is inferred from the current program template.
 */
function countDistinctTrainedExercises(
  sessions: ReadonlyArray<CompletedWorkoutSession>,
): number {
  const trained = new Set<ExerciseId>();
  for (const session of sessions) {
    for (const log of session.exerciseLogs) {
      if (log.sets.length === 0) continue;
      trained.add(log.performedExerciseId);
    }
  }
  return trained.size;
}
