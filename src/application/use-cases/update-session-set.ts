/**
 * Use case: update an existing set in an in-progress workout session.
 */

import {
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  updateSessionSet,
  type UpdateSetCommandInput,
  type SessionMutationError,
} from '@/domain/entities/workout-session';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type UpdateSessionSetError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  | SessionMutationError;

export interface UpdateSessionSetInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
  readonly type: 'reps';
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface UpdateSessionDurationSetInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
  readonly type: 'duration';
  readonly durationSeconds: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export type UpdateSessionSetCommandInput = UpdateSessionSetInput | UpdateSessionDurationSetInput;

export class UpdateSessionSetUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: UpdateSessionSetCommandInput,
  ): Promise<Result<WorkoutSessionDto, UpdateSessionSetError>> {
    const idResult = createWorkoutSessionId(input.sessionId);
    if (!idResult.ok) {
      return err({ code: 'INVALID_INPUT', message: idResult.error.message, field: 'sessionId' });
    }

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
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

    const domainInput: UpdateSetCommandInput =
      input.type === 'reps'
        ? {
            exerciseOrder: input.exerciseOrder,
            setNumber: input.setNumber,
            type: 'reps',
            reps: input.reps,
            weightKg: input.weightKg,
            rpe: input.rpe,
          }
        : {
            exerciseOrder: input.exerciseOrder,
            setNumber: input.setNumber,
            type: 'duration',
            durationSeconds: input.durationSeconds,
            weightKg: input.weightKg,
            rpe: input.rpe,
          };

    const result = updateSessionSet(session, domainInput);
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
      throw error;
    }

    return ok(toWorkoutSessionDto(result.data));
  }
}