/**
 * Server-side view assembly for the Active Workout (session) screen.
 *
 * Orchestrates the existing read-only use cases — scheduled workout detail,
 * the user's session state for the occurrence, and ONE batched progressive
 * overload target request built from the SESSION SNAPSHOT's prescriptions —
 * into a serializable view for the presentational components. It derives
 * nothing the application layer does not already expose.
 *
 * Prescription source (deliberate, and the mirror image of
 * `workout-detail-view.ts`): once a session exists, the snapshot's
 * prescriptions are the truth of what was prescribed THAT day — the scheduled
 * workout/template may have been reprogrammed since. Recommendations are
 * computed under the snapshot prescriptions; they read only the latest
 * COMPLETED performance, so they stay stable mid-session.
 *
 * Exercise metadata (M9): names, equipment, authored context and
 * substitution candidates ALL resolve from ONE exercise-catalog read per
 * request (GetActiveWorkoutExerciseDataUseCase) — performed ids, authored
 * ids, and every distinct performed source's candidate set, with no
 * per-source repository reads (no N+1). The session DTO carries neither
 * names nor equipment; a catalog entry that no longer exists renders the
 * truthful fallback "Exercise N", omits equipment, and omits the
 * "Originally" line — never fabricated.
 */

import type { ExerciseSummaryDto, ExerciseTargetDto } from '@/application/dto/exercise';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { UserDto } from '@/application/dto/user';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import { createExerciseId, type ExerciseId } from '@/domain/types/ids';
import {
  buildSessionExerciseCardViews,
  buildSessionProgress,
  type SessionExerciseCardView,
  type SessionExerciseCatalogMeta,
  type SessionProgressView,
} from '@/features/sessions/active-workout-views';
import { lookupScheduledWorkout } from '@/features/programs/scheduled-workout-lookup';
import {
  resolveSessionProgramCompletionFact,
  type SessionProgramCompletionFact,
} from '@/features/sessions/program-completion-fact';
import {
  getActiveWorkoutExerciseDataUseCase,
  getNextExerciseTargetsUseCase,
  getWorkoutSessionUseCase,
} from '@/features/sessions/services';

export type ActiveWorkoutScreenState =
  | 'not-enrolled'
  | 'not-started'
  | 'in-progress'
  | 'completed';

export interface ActiveWorkoutView {
  /** The scheduled occurrence (always resolvable before this view is built). */
  readonly workout: ScheduledWorkoutDetailDto;
  /** The session snapshot; null when none exists for this occurrence. */
  readonly session: WorkoutSessionDto | null;
  /** One card per session exercise log, in log order. */
  readonly cards: ReadonlyArray<SessionExerciseCardView>;
  /** Null on the not-started and not-enrolled states. */
  readonly progress: SessionProgressView | null;
  /**
   * The full exercise catalog the user may explicitly add to the session
   * (M11), in the repository's list order — resolved from the SAME single
   * catalog read that feeds display metadata and substitution candidates.
   * Empty when no session exists yet.
   */
  readonly addableExercises: ReadonlyArray<ExerciseSummaryDto>;
  readonly screenState: ActiveWorkoutScreenState;
  /**
   * M14 program-complete surfacing: non-null ONLY when this completed
   * session's current program enrollment is authoritatively complete
   * (server-derived). Null for every other screen state, for incomplete or
   * missing enrollments, and when the optional read is unavailable — never
   * inferred from workout order and never counted in Presentation.
   */
  readonly programCompletion: SessionProgramCompletionFact | null;
}

/** A targets array meaning "no personalized target for any position". */
function noTargets(count: number): (ExerciseTargetDto | null)[] {
  return Array.from({ length: count }, () => null);
}

/**
 * Resolves the advisory overload targets for the session snapshot's logs.
 *
 * ONE batched request carries every NON-SKIPPED log's
 * `{exerciseId, prescription}` from the snapshot (no per-log use-case calls;
 * duplicate exercise ids are fine — the use case deduplicates its queries and
 * returns one target per request position, in order). Skipped occurrences
 * are never requested: they render no logger, so their target would be dead
 * weight — and a later unskip re-resolves it fresh on the next request.
 *
 * The RESULT stays positionally aligned with `session.exerciseLogs` — one
 * entry per log, `null` at every skipped index — because
 * `buildSessionExerciseCardViews` zips `targets` to `logs` by position. The
 * batch is shorter than the log list whenever anything is skipped; zipping a
 * shorter array would silently associate later logs with the wrong targets.
 * On any typed failure the session content stays intact and
 * recommendations/prefill are simply omitted — a personalization glitch
 * must not make an in-progress session unusable.
 */
async function resolveSnapshotTargets(
  userId: string,
  session: WorkoutSessionDto,
): Promise<ReadonlyArray<ExerciseTargetDto | null>> {
  const requests: {
    readonly exerciseId: ExerciseId;
    readonly prescription: WorkoutSessionDto['exerciseLogs'][number]['prescription'];
  }[] = [];
  const nonSkippedIndexes: number[] = [];
  for (const [index, log] of session.exerciseLogs.entries()) {
    if (log.isSkipped) {
      continue;
    }
    const idResult = createExerciseId(log.performedExerciseId);
    if (!idResult.ok) {
      // Defensive: catalog ids are non-empty by the schema's constraints, so
      // this is unreachable — treat like a personalization failure and omit.
      return noTargets(session.exerciseLogs.length);
    }
    requests.push({ exerciseId: idResult.data, prescription: log.prescription });
    nonSkippedIndexes.push(index);
  }

  if (requests.length === 0) {
    return noTargets(session.exerciseLogs.length);
  }

  const result = await getNextExerciseTargetsUseCase.execute({ userId, requests });
  if (!result.ok || result.data.length !== requests.length) {
    // Recoverable personalization failure (EXERCISE_NOT_FOUND: the catalog
    // changed mid-request): omit recommendations, keep the session content.
    return noTargets(session.exerciseLogs.length);
  }

  // Re-expand the batched, order-preserving result back onto the full log
  // positions — null fills every skipped slot (and any impossible short
  // result, guarded above, already degraded to the all-null array).
  const aligned: (ExerciseTargetDto | null)[] = Array.from(
    { length: session.exerciseLogs.length },
    () => null,
  );
  nonSkippedIndexes.forEach((logIndex, requestIndex) => {
    aligned[logIndex] = result.data[requestIndex] ?? null;
  });
  return aligned;
}

/**
 * Resolves catalog metadata (name, equipment) for the session snapshot's
 * exercise logs — performed AND authored ids — from the summaries map the
 * ONE catalog read already produced.
 *
 * A log whose performed exercise is absent from the catalog (the catalog
 * changed since the snapshot) renders the truthful "Exercise N" fallback
 * and omits equipment — never fabricated.
 */
function resolveCatalogMeta(
  session: WorkoutSessionDto,
  summariesByExerciseId: ReadonlyMap<string, ExerciseSummaryDto>,
): ReadonlyMap<string, SessionExerciseCatalogMeta> {
  const resolved = new Map<string, SessionExerciseCatalogMeta>();
  for (const log of session.exerciseLogs) {
    const performed = summariesByExerciseId.get(log.performedExerciseId);
    if (performed !== undefined) {
      resolved.set(log.performedExerciseId, {
        name: performed.name,
        equipment: performed.equipment,
      });
    }
    const authored = summariesByExerciseId.get(log.authoredExerciseId);
    if (authored !== undefined) {
      resolved.set(log.authoredExerciseId, {
        name: authored.name,
        equipment: authored.equipment,
      });
    }
  }
  return resolved;
}

/**
 * Builds the Active Workout view for one occurrence.
 *
 * The workout must have resolved already (callers run `getScheduledWorkout`
 * first and notFound() on failure); this function returns null only when that
 * contract is broken, which callers should treat as not-found. The user is
 * never null here: the session page is private and calls `requireUser()`
 * before building the view.
 */
export async function buildActiveWorkoutView(
  input: {
    readonly programSlug: string;
    readonly weekNumber: number;
    readonly workoutOrder: number;
  },
  user: UserDto,
): Promise<ActiveWorkoutView | null> {
  // Request-cached: generateMetadata and the page share ONE scheduled-workout
  // execution per request (see scheduled-workout-lookup).
  const workoutResult = await lookupScheduledWorkout(
    input.programSlug,
    input.weekNumber,
    input.workoutOrder,
  );
  if (!workoutResult.ok) {
    return null;
  }
  const workout = workoutResult.data;

  const sessionResult = await getWorkoutSessionUseCase.execute({
    userId: user.id,
    ...input,
  });
  if (!sessionResult.ok) {
    // The occurrence resolved moments ago for the workout query; a second
    // resolution failure is an unexpected state, not a business outcome.
    throw new Error(
      `Failed to resolve session state for workout "${workout.workout.slug}" (week ${input.weekNumber}, order ${input.workoutOrder}): ${sessionResult.error.message}`,
    );
  }

  const { enrolled, session } = sessionResult.data;

  if (!enrolled || session === null) {
    return {
      workout,
      session: null,
      cards: [],
      progress: null,
      addableExercises: [],
      screenState: !enrolled ? 'not-enrolled' : 'not-started',
      programCompletion: null,
    };
  }

  const targets = await resolveSnapshotTargets(user.id, session);

  // THE ONE exercise-catalog read of this request: performed metadata,
  // authored metadata, and the substitution candidates of every distinct
  // performed exercise all resolve from it (see the use case). A subsequent
  // re-render of this view performs its own single read.
  const exerciseData = await getActiveWorkoutExerciseDataUseCase.execute({
    displayExerciseIds: session.exerciseLogs.flatMap((log) => [
      log.performedExerciseId,
      log.authoredExerciseId,
    ]),
    performedExerciseIds: session.exerciseLogs.map((log) => log.performedExerciseId),
  });
  const catalogByExerciseId = resolveCatalogMeta(session, exerciseData.summariesByExerciseId);

  const screenState: ActiveWorkoutScreenState =
    session.status === 'completed' ? 'completed' : 'in-progress';

  // M14 (Slice 7): the program-complete callout read runs ONLY for the
  // completed state — active/not-started/not-enrolled screens never invoke
  // the enrollment view. The workout DTO already carries the program name,
  // so no display data is re-derived here.
  const programCompletion =
    screenState === 'completed'
      ? await resolveSessionProgramCompletionFact(
          { programSlug: input.programSlug, programName: workout.programName },
          user.id,
        )
      : null;

  return {
    workout,
    session,
    cards: buildSessionExerciseCardViews({
      logs: session.exerciseLogs,
      targets,
      catalogByExerciseId,
      candidatesByPerformedExerciseId: exerciseData.candidatesByPerformedExerciseId,
      sessionStatus: screenState,
    }),
    progress: buildSessionProgress(session),
    addableExercises: exerciseData.addableExercises,
    screenState,
    programCompletion,
  };
}

