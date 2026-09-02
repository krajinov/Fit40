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
 * Exercise names/equipment are resolved server-side from the exercise
 * catalog by the snapshot's exercise ids. The session DTO carries neither
 * names nor equipment; a catalog entry that no longer exists renders the
 * truthful fallback "Exercise N" and omits equipment — never fabricated.
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
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
import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import { getNextExerciseTargetsUseCase, getWorkoutSessionUseCase } from '@/features/sessions/services';

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
  readonly screenState: ActiveWorkoutScreenState;
}

/** A targets array meaning "no personalized target for any position". */
function noTargets(count: number): (ExerciseTargetDto | null)[] {
  return Array.from({ length: count }, () => null);
}

/**
 * Resolves the advisory overload targets for the session snapshot's logs.
 *
 * ONE batched request carries every log's `{exerciseId, prescription}` from
 * the snapshot (no per-log use-case calls; duplicate exercise ids are fine —
 * the use case deduplicates its queries and returns one target per request
 * position, in order). On any typed failure the session content stays intact
 * and recommendations/prefill are simply omitted — a personalization glitch
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
  for (const log of session.exerciseLogs) {
    const idResult = createExerciseId(log.exerciseId);
    if (!idResult.ok) {
      // Defensive: catalog ids are non-empty by the schema's constraints, so
      // this is unreachable — treat like a personalization failure and omit.
      return noTargets(session.exerciseLogs.length);
    }
    requests.push({ exerciseId: idResult.data, prescription: log.prescription });
  }

  if (requests.length === 0) {
    return [];
  }

  const result = await getNextExerciseTargetsUseCase.execute({ userId, requests });
  if (!result.ok) {
    // Recoverable personalization failure (EXERCISE_NOT_FOUND: the catalog
    // changed mid-request): omit recommendations, keep the session content.
    return noTargets(session.exerciseLogs.length);
  }

  return result.data;
}

/**
 * Resolves catalog metadata (name, equipment) for the session snapshot's
 * exercise logs — from the scheduled workout DTO already loaded for the
 * screen, by exercise id. No extra data access: the session DTO carries
 * neither names nor equipment, but the occurrence's exercise list does.
 *
 * A log whose exercise is absent from the scheduled workout (the catalog or
 * the program changed since the snapshot) renders the truthful "Exercise N"
 * fallback and omits equipment — never fabricated.
 */
function resolveCatalogMeta(
  session: WorkoutSessionDto,
  workout: ScheduledWorkoutDetailDto,
): ReadonlyMap<string, SessionExerciseCatalogMeta> {
  const byExerciseId = new Map<string, SessionExerciseCatalogMeta>();
  for (const exercise of workout.workout.exercises) {
    if (!byExerciseId.has(exercise.exerciseId)) {
      byExerciseId.set(exercise.exerciseId, {
        name: exercise.exerciseName,
        equipment: exercise.equipment,
      });
    }
  }

  const resolved = new Map<string, SessionExerciseCatalogMeta>();
  for (const log of session.exerciseLogs) {
    const match = byExerciseId.get(log.exerciseId);
    if (match !== undefined) {
      resolved.set(log.exerciseId, match);
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
  const workoutResult = await getScheduledWorkoutUseCase.execute(input);
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
      screenState: !enrolled ? 'not-enrolled' : 'not-started',
    };
  }

  const targets = await resolveSnapshotTargets(user.id, session);
  const catalogByExerciseId = resolveCatalogMeta(session, workout);

  const screenState: ActiveWorkoutScreenState =
    session.status === 'completed' ? 'completed' : 'in-progress';

  return {
    workout,
    session,
    cards: buildSessionExerciseCardViews({
      logs: session.exerciseLogs,
      targets,
      catalogByExerciseId,
      sessionStatus: screenState,
    }),
    progress: buildSessionProgress(session.exerciseLogs, session.metrics),
    screenState,
  };
}

