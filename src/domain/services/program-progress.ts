/**
 * Pure domain logic for program scheduling, progress, completion, and
 * next-workout resolution.
 *
 * Operates on a TrainingProgram and caller-supplied lists/facts of completed
 * ScheduledWorkoutIds. No repository or framework dependencies.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import type { ScheduledWorkoutId } from '@/domain/types/ids';

/**
 * Returns every scheduled workout in deterministic program order:
 * by week number ascending, then by order within the week ascending.
 */
export function listScheduledWorkoutsInOrder(
  program: TrainingProgram,
): ReadonlyArray<ScheduledWorkout> {
  return program.weeks.flatMap((week) =>
    [...week.scheduledWorkouts].sort((a, b) => a.order - b.order),
  );
}

function uniqueIds(ids: ReadonlyArray<ScheduledWorkoutId>): ReadonlyArray<ScheduledWorkoutId> {
  return [...new Set(ids)];
}

/**
 * Structured result of calculating program progress.
 */
export interface ProgramProgress {
  readonly totalWorkouts: number;
  readonly completedWorkouts: number;
  readonly remainingWorkouts: number;
  readonly percentage: number;
  readonly unrecognizedIds: ReadonlyArray<ScheduledWorkoutId>;
}

/**
 * Calculates progress for a program given a caller-supplied list of completed
 * occurrence IDs.
 *
 * Behavior:
 * - Duplicates in completedIds are counted once.
 * - Unknown ids (not present in the program) are ignored in the count but
 *   returned in `unrecognizedIds` so callers can detect bad input.
 * - percentage is an integer 0..100.
 */
export function calculateProgramProgress(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): ProgramProgress {
  const scheduledInOrder = listScheduledWorkoutsInOrder(program);
  const scheduledIdSet = new Set(scheduledInOrder.map((scheduled) => scheduled.id));
  const uniqueCompleted = uniqueIds(completedIds);

  const completedWorkouts = uniqueCompleted.filter((id) => scheduledIdSet.has(id)).length;
  const unrecognizedIds = uniqueCompleted.filter((id) => !scheduledIdSet.has(id));
  const totalWorkouts = scheduledInOrder.length;
  const remainingWorkouts = totalWorkouts - completedWorkouts;

  const percentage =
    totalWorkouts === 0 ? 0 : Math.round((completedWorkouts / totalWorkouts) * 100);

  return {
    totalWorkouts,
    completedWorkouts,
    remainingWorkouts,
    percentage,
    unrecognizedIds,
  };
}

/**
 * Returns the next scheduled workout in program order that is not marked as
 * completed.
 *
 * Behavior:
 * - Nothing completed → first workout.
 * - Some completed → first uncompleted workout in program order.
 * - Out-of-order completion → still returns the first uncompleted in program order.
 * - All completed → null.
 * - Unknown completed IDs → ignored.
 *
 * Note: an empty schedule also yields null (there is no uncompleted
 * workout). That null is a preview fact, NOT an authoritative completion
 * verdict — see `isProgramComplete`, which deliberately reports a
 * zero-schedule program as not complete.
 */
export function getNextWorkout(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): ScheduledWorkout | null {
  const scheduledInOrder = listScheduledWorkoutsInOrder(program);
  const completedSet = new Set(completedIds);

  return scheduledInOrder.find((scheduled) => !completedSet.has(scheduled.id)) ?? null;
}

// ─── Program completion (M14) ────────────────────────────────────────────────

/**
 * One completed-session fact relevant to program completion: the scheduled
 * occurrence the session fulfilled and when it completed.
 *
 * Structurally a subset of the workout-session aggregate's completion
 * fields, so callers map persisted sessions down to this shape without this
 * service knowing about persistence or the aggregate's full shape.
 */
export interface SessionCompletionFact {
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly completedAt: Date;
}

/**
 * Authoritative completion rule for a program run (M14): the run is complete
 * iff the program defines at least one scheduled workout AND every scheduled
 * workout of the program is represented in `completedIds`.
 *
 * Behavior:
 * - Builds on `calculateProgramProgress`, so completion cannot drift from
 *   progress semantics: duplicate completed ids count once and unknown ids
 *   are ignored — neither can change the outcome.
 * - A zero-schedule program is NEVER complete, even though coverage over an
 *   empty set would otherwise be vacuously true.
 * - Exercise-level skipped state is irrelevant here: whether a completed
 *   session qualifies is session-completion semantics owned elsewhere
 *   (`resolveSessionCompletionReadiness` / `completeWorkoutSession`).
 *
 * Deliberate divergence — zero-schedule program (documented, locked and
 * pinned by tests; NOT an accidental inconsistency): `getNextWorkout` returns
 * null for an empty schedule ("no uncompleted workout"), and the dashboard /
 * program-panel preview historically renders that null as its `complete`
 * preview state. That preview keying is unreachable with the current seeds
 * and is explicitly out of M14 scope to reconcile. This function is the
 * authoritative rule for the completion summary and the restart gate, where
 * "nothing was ever scheduled" must never count as completion.
 */
export function isProgramComplete(
  program: TrainingProgram,
  completedIds: ReadonlyArray<ScheduledWorkoutId>,
): boolean {
  const progress = calculateProgramProgress(program, completedIds);
  return progress.totalWorkouts > 0 && progress.remainingWorkouts === 0;
}

/**
 * Resolves the completion instant of a program's schedule from
 * caller-supplied completed-session facts: the LATEST `completedAt` among
 * sessions whose `scheduledWorkoutId` belongs to `program`, or null when no
 * session matches.
 *
 * Behavior:
 * - Only the program's own scheduled occurrences participate; sessions of
 *   other programs or runs (unknown ids) never contribute, so an unknown
 *   session with a later timestamp can never become the completion date.
 * - Input order never matters: the result is the maximum by instant, and
 *   equal instants are equal results.
 * - Inputs are never mutated, and the returned Date is a fresh value, so a
 *   caller cannot mutate the supplied facts through the result.
 *
 * This function does NOT decide whether the program is complete — it only
 * resolves the latest relevant completion timestamp. Completion itself is
 * `isProgramComplete`; callers evaluate the two together.
 */
export function resolveProgramCompletionDate(
  program: TrainingProgram,
  completedSessions: ReadonlyArray<SessionCompletionFact>,
): Date | null {
  const scheduledIdSet = new Set(
    listScheduledWorkoutsInOrder(program).map((scheduled) => scheduled.id),
  );

  let latest: Date | null = null;
  for (const session of completedSessions) {
    if (!scheduledIdSet.has(session.scheduledWorkoutId)) continue;
    if (latest === null || session.completedAt.getTime() > latest.getTime()) {
      latest = session.completedAt;
    }
  }

  return latest === null ? null : new Date(latest.getTime());
}