/**
 * Use case: explicitly add one catalog exercise to an in-progress workout
 * session (M11).
 *
 * Pure orchestration of the M11 Add contract: validate the boundary input,
 * load the session, enforce ownership and enrollment, reject stale rendered
 * intent, verify the selected exercise exists server-side, build the user's
 * EXPLICIT prescription, then delegate EVERY composition invariant
 * (completed-session immutability, append position, provenance, occurrence
 * key, high-water-mark advance) to the domain service. The program/workout
 * template is never touched.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client input. The caller cannot supply
 * occurrenceKey, exerciseOrder, source, nextOccurrenceKey, the authored or
 * performed identity, or restSeconds — the domain derives them all.
 *
 * The explicit prescription's shape validation and construction live in
 * `add-session-exercise-prescription.ts`.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  buildSessionAddedPrescription,
  prescriptionInputError,
  SESSION_ADDED_REST_SECONDS,
  type AddSessionExerciseChoice,
  type AddSessionExerciseDurationChoice,
  type AddSessionExercisePrescriptionError,
  type AddSessionExerciseRepsChoice,
} from '@/application/use-cases/add-session-exercise-prescription';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import {
  addSessionExercise,
  type SessionCompositionError,
} from '@/domain/services/session-exercise-composition';
import { createExerciseId, createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import {
  isValidExpectedSessionVersion,
  rejectStaleRenderedIntent,
} from '@/application/use-cases/session-version-guard';

// ─── Input ───────────────────────────────────────────────────────────────────

/** Fields every Add command carries, regardless of prescription scheme. */
interface AddSessionExerciseBaseInput {
  readonly sessionId: string;
  readonly userId: string;
  /** The exercise explicitly selected from the catalog (stable catalog id). */
  readonly exerciseId: string;
  /**
   * The session `version` of the snapshot the caller rendered (PR #13
   * Finding 1): compared against the freshly loaded aggregate BEFORE any
   * mutation, so a stale tab never appends against a session it no longer
   * sees.
   */
  readonly expectedSessionVersion: number;
}

/** Explicit REP prescription: the user chose a rep target. */
export interface AddSessionExerciseRepsInput
  extends AddSessionExerciseBaseInput,
    AddSessionExerciseRepsChoice {}

/** Explicit DURATION prescription: the user chose a duration target. */
export interface AddSessionExerciseDurationInput
  extends AddSessionExerciseBaseInput,
    AddSessionExerciseDurationChoice {}

/**
 * The Add command. The discriminated union makes the two schemes
 * non-interchangeable: a duration add cannot carry `targetReps`, and a reps
 * add cannot carry `durationSeconds`.
 */
export type AddSessionExerciseInput =
  | AddSessionExerciseRepsInput
  | AddSessionExerciseDurationInput;

// ─── Errors ──────────────────────────────────────────────────────────────────

export type AddSessionExerciseError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'EXERCISE_NOT_FOUND'; readonly exerciseId: string; readonly message: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  // Malformed prescription input (shared shape with INVALID_INPUT above).
  | AddSessionExercisePrescriptionError
  // The domain service's expected composition failures (completed session)
  // surface with their own codes — the composition invariants stay owned by
  // the domain.
  | SessionCompositionError;

// ─── Use case ────────────────────────────────────────────────────────────────

export class AddSessionExerciseUseCase {
  constructor(
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: AddSessionExerciseInput,
  ): Promise<Result<WorkoutSessionDto, AddSessionExerciseError>> {
    const idResult = createWorkoutSessionId(input.sessionId);
    if (!idResult.ok) {
      return err({ code: 'INVALID_INPUT', message: idResult.error.message, field: 'sessionId' });
    }

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const exerciseIdResult = createExerciseId(input.exerciseId);
    if (!exerciseIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: exerciseIdResult.error.message,
        field: 'exerciseId',
      });
    }

    const choice: AddSessionExerciseChoice = input;
    const shapeError = prescriptionInputError(choice);
    if (shapeError !== null) {
      return err(shapeError);
    }

    if (!isValidExpectedSessionVersion(input.expectedSessionVersion)) {
      return err({
        code: 'INVALID_INPUT',
        message: 'expectedSessionVersion must be a non-negative integer',
        field: 'expectedSessionVersion',
      });
    }

    const session = await this.sessionRepository.findById(idResult.data);
    if (session === null) {
      return err({
        code: 'SESSION_NOT_FOUND',
        sessionId: input.sessionId,
        message: `Session "${input.sessionId}" not found`,
      });
    }

    // Ownership: only the session's owner may mutate it. The userId comes
    // from the trusted authenticated session, never from client input.
    if (session.userId !== userIdResult.data) {
      return err({ code: 'FORBIDDEN', message: 'You do not have access to this session.' });
    }

    // A detached session (enrollment_id nulled by leaving the program) is
    // historical, read-only data. No enrollment lookup is needed beyond this
    // null check: the FK's ON DELETE SET NULL guarantees a non-null
    // enrollment_id references a live enrollment owned by this session's
    // user, and a leave-and-rejoin creates a NEW enrollment identity that
    // can never reattach the old detached session.
    if (session.enrollmentId === null) {
      return err({
        code: 'NOT_ENROLLED',
        message:
          'You are no longer enrolled in this program, so this session can no longer be modified.',
      });
    }

    // Stale rendered intent (PR #13 Finding 1): reject BEFORE mutating, so a
    // tab rendered against an older session appends nothing.
    const versionCheck = rejectStaleRenderedIntent(input.expectedSessionVersion, session);
    if (!versionCheck.ok) {
      return err(versionCheck.error);
    }

    // Server-side existence check: the selection must be a real catalog
    // exercise — a client-supplied unknown id never reaches the domain or the
    // write boundary. The port's targeted lookup is the smallest authoritative
    // proof; the full catalog is never loaded for one id.
    const [selectedExercise] = await this.exerciseRepository.findByIds([exerciseIdResult.data]);
    if (selectedExercise === undefined) {
      return err({
        code: 'EXERCISE_NOT_FOUND',
        exerciseId: input.exerciseId,
        message: `Exercise "${input.exerciseId}" was not found in the exercise catalog`,
      });
    }

    const prescriptionResult = buildSessionAddedPrescription(choice);
    if (!prescriptionResult.ok) {
      return prescriptionResult;
    }

    const result = addSessionExercise(session, {
      exerciseId: exerciseIdResult.data,
      prescription: prescriptionResult.data,
      restSeconds: SESSION_ADDED_REST_SECONDS,
    });
    if (!result.ok) {
      return result;
    }

    // The repository returns the PERSISTED aggregate, whose `version` is the
    // one the database committed. Building the DTO from it — never from the
    // pre-save snapshot — is what lets a caller feed this result straight back
    // as its next mutation's `expectedSessionVersion` (PR #13 Finding 5).
    let persisted: WorkoutSession;
    try {
      persisted = await this.sessionRepository.save(result.data);
    } catch (error) {
      if (error instanceof SessionStaleVersionError) {
        return err({
          code: 'SESSION_MODIFIED',
          message: `Session "${input.sessionId}" was modified concurrently; reload and retry`,
        });
      }
      if (error instanceof SessionEnrollmentChangedError) {
        // The write itself observed the enrollment vanish or change after the
        // snapshot was loaded: the session is detached history now, and the
        // mutation did not commit.
        return err({
          code: 'NOT_ENROLLED',
          message:
            'You are no longer enrolled in this program, so this session can no longer be modified.',
        });
      }
      throw error;
    }

    return ok(toWorkoutSessionDto(persisted));
  }
}
