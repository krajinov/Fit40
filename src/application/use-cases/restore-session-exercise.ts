/**
 * Use case: restore one substituted occurrence back to performed-as-authored
 * identity in an in-progress workout session.
 *
 * Same guard chain as substitution (validate → load → ownership →
 * enrollment → domain → optimistic-concurrency save), minus the
 * replacement-exercise lookup: the authored identity is already part of the
 * session snapshot, so no catalog read is needed. Every restore invariant
 * (immutability, occurrence existence, logged-set block, no-change) is
 * delegated to the domain service and never duplicated here.
 *
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client input.
 */

import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { restoreSessionExercise, type SessionSubstitutionError } from '@/domain/services/session-exercise-substitution';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type RestoreSessionExerciseError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  // The domain service's expected substitution failures (completed session,
  // unknown occurrence, logged-set block, no-change) surface with their own
  // codes — the restore invariants stay owned by the domain.
  | SessionSubstitutionError;

export interface RestoreSessionExerciseInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
}

export class RestoreSessionExerciseUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: RestoreSessionExerciseInput,
  ): Promise<Result<WorkoutSessionDto, RestoreSessionExerciseError>> {
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

    const result = restoreSessionExercise(session, { exerciseOrder: input.exerciseOrder });
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
