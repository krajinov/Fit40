/**
 * Server-side view assembly for the scheduled workout detail screen.
 *
 * Orchestrates the existing read-only use cases (scheduled workout detail,
 * the user's session state for the occurrence, and one batched progressive
 * overload target request) into a serializable view for the presentational
 * components. It derives nothing the application layer does not already
 * expose.
 *
 * Prescriptions come from the CURRENT scheduled workout/template —
 * deliberately so, and different from the Active Workout screen, which must
 * use the session snapshot's prescriptions once it exists.
 */

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { UserDto } from '@/application/dto/user';
import { createExerciseId, type ExerciseId } from '@/domain/types/ids';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';
import { lookupScheduledWorkout } from '@/features/programs/scheduled-workout-lookup';
import { getNextExerciseTargetsUseCase } from '@/features/sessions/services';
import { getWorkoutSessionUseCase } from '@/features/sessions/services';
import {
  mapExerciseTargetsToViews,
  type WorkoutExerciseTargetView,
} from '@/features/sessions/workout-target-views';

/** How the CTA band presents the occurrence to the current visitor. */
export type WorkoutCtaState = 'anonymous' | 'not-enrolled' | 'start' | 'resume' | 'completed';

export interface WorkoutDetailView {
  readonly workout: ScheduledWorkoutDetailDto;
  /** One entry per workout exercise, aligned with `workout.workout.exercises`. */
  readonly targets: ReadonlyArray<WorkoutExerciseTargetView>;
  /** Whether any target resolved a personalized recommendation chip. */
  readonly hasRecommendations: boolean;
  /** CTA state for the start panel (see {@link WorkoutCtaState}). */
  readonly ctaState: WorkoutCtaState;
}

/** A target view meaning "nothing personalized for this position". */
function noTarget(): WorkoutExerciseTargetView {
  return { exerciseId: '', lastTimeLabel: null, lastTimeCompactLabel: null, chip: null };
}

/**
 * Resolves the personalized overload targets for the workout's exercises.
 *
 * Builds ONE batched request carrying every exercise with the prescription
 * from the current scheduled workout (no per-exercise use-case calls, no
 * rediscovery of prescriptions inside the use case; duplicate exercise ids
 * are fine — the use case deduplicates its queries and returns one target
 * per request position in order). On any typed failure the public workout
 * content stays intact and the recommendations are simply omitted — a
 * personalization glitch must not make the workout unreadable.
 */
async function resolveTargets(
  userId: string,
  workout: ScheduledWorkoutDetailDto,
): Promise<ReadonlyArray<WorkoutExerciseTargetView>> {
  const prescriptions: RepPrescription[] = [];
  const requests: { readonly exerciseId: ExerciseId; readonly prescription: RepPrescription }[] = [];
  for (const exercise of workout.workout.exercises) {
    prescriptions.push(exercise.prescription);
    const idResult = createExerciseId(exercise.exerciseId);
    if (idResult.ok) {
      requests.push({ exerciseId: idResult.data, prescription: exercise.prescription });
    }
  }

  if (requests.length === 0 || requests.length !== prescriptions.length) {
    // Defensive: catalog ids are non-empty by the schema's constraints, so
    // this is unreachable — treat like a personalization failure and omit.
    return prescriptions.map(() => noTarget());
  }

  const result = await getNextExerciseTargetsUseCase.execute({ userId, requests });
  if (!result.ok) {
    // Recoverable personalization failure: omit recommendations, keep the
    // public workout content (the error contract does not require failing
    // the page — EXERCISE_NOT_FOUND means the catalog changed mid-request,
    // INVALID_INPUT is unreachable with the trusted user id).
    return prescriptions.map(() => noTarget());
  }

  return mapExerciseTargetsToViews(result.data, prescriptions);
}


/**
 * Builds the workout detail view for one scheduled workout occurrence.
 *
 * `user` is null for anonymous visitors: the workout stays fully readable
 * and public, no personalized recommendation is resolved, and the CTA state
 * reflects the sign-in flow. Authenticated users get recommendations from
 * their own history (the use case scopes by `user.id`) and their session
 * state for the occurrence.
 */
export async function buildWorkoutDetailView(
  input: {
    readonly programSlug: string;
    readonly weekNumber: number;
    readonly workoutOrder: number;
  },
  user: UserDto | null,
): Promise<WorkoutDetailView | null> {
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

  if (user === null) {
    return {
      workout,
      targets: workout.workout.exercises.map(() => noTarget()),
      hasRecommendations: false,
      ctaState: 'anonymous',
    };
  }

  const [targets, sessionResult] = await Promise.all([
    resolveTargets(user.id, workout),
    getWorkoutSessionUseCase.execute({ userId: user.id, ...input }),
  ]);

  if (!sessionResult.ok) {
    // The occurrence resolved moments ago for the workout query; a second
    // resolution failure is an unexpected state, not a business outcome.
    throw new Error(
      `Failed to resolve session state for workout "${workout.workout.slug}" (week ${input.weekNumber}, order ${input.workoutOrder}): ${sessionResult.error.message}`,
    );
  }

  const session = sessionResult.data.session;
  const ctaState: WorkoutCtaState = !sessionResult.data.enrolled
    ? 'not-enrolled'
    : session === null
      ? 'start'
      : session.status === 'completed'
        ? 'completed'
        : 'resume';

  return {
    workout,
    targets,
    hasRecommendations: targets.some((target) => target.chip !== null),
    ctaState,
  };
}
