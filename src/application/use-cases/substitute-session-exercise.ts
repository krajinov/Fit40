/**
 * Use case: substitute the performed exercise of one occurrence in an
 * in-progress workout session.
 *
 * Pure orchestration of the M9 substitution contract: the application layer
 * validates input, loads the session, enforces ownership and enrollment,
 * and verifies the replacement exercise exists server-side — then delegates
 * EVERY substitution invariant (immutability, occurrence existence,
 * logged-set block, no-change) to the domain service. The substitution
 * semantics themselves (authored identity, prescription and rest carry over
 * untouched) live in `session-exercise-substitution.ts` and are never
 * duplicated here.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client input.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  substituteSessionExercise,
  type SessionSubstitutionError,
} from '@/domain/services/session-exercise-substitution';
import { createExerciseId, createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type SubstituteSessionExerciseError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'EXERCISE_NOT_FOUND'; readonly exerciseId: string; readonly message: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  // The domain service's expected substitution failures (completed session,
  // unknown occurrence, logged-set block, no-change) surface with their own
  // codes — the substitution invariants stay owned by the domain.
  | SessionSubstitutionError;

export interface SubstituteSessionExerciseInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  readonly replacementExerciseId: string;
}

export class SubstituteSessionExerciseUseCase {
  constructor(
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: SubstituteSessionExerciseInput,
  ): Promise<Result<WorkoutSessionDto, SubstituteSessionExerciseError>> {
    const idResult = createWorkoutSessionId(input.sessionId);
    if (!idResult.ok) {
      return err({ code: 'INVALID_INPUT', message: idResult.error.message, field: 'sessionId' });
    }

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    if (!Number.isInteger(input.exerciseOrder) || input.exerciseOrder < 1) {
      return err({
        code: 'INVALID_INPUT',
        message: 'exerciseOrder must be an integer of at least 1',
        field: 'exerciseOrder',
      });
    }

    const replacementResult = createExerciseId(input.replacementExerciseId);
    if (!replacementResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: replacementResult.error.message,
        field: 'replacementExerciseId',
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

    // Server-side existence check: the replacement must be a real catalog
    // exercise — a client-supplied unknown id never reaches the domain or
    // the write boundary. The port contract guarantees at most one exercise
    // per requested id, so a missing first element means not found.
    const [replacement] = await this.exerciseRepository.findByIds([replacementResult.data]);
    if (replacement === undefined) {
      return err({
        code: 'EXERCISE_NOT_FOUND',
        exerciseId: input.replacementExerciseId,
        message: `Exercise "${input.replacementExerciseId}" was not found in the exercise catalog`,
      });
    }

    const result = substituteSessionExercise(session, {
      exerciseOrder: input.exerciseOrder,
      replacementExerciseId: replacementResult.data,
    });
    if (!result.ok) {
      return result;
    }

    try {
      await this.sessionRepository.save(result.data);
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

    return ok(toWorkoutSessionDto(result.data));
  }
}
