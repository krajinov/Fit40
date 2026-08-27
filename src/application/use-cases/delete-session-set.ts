/**
 * Use case: delete a set from an in-progress workout session.
 */

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  deleteSessionSet,
  type DeleteSetInput,
  type SessionMutationError,
} from '@/domain/entities/workout-session';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';
import {
  toSessionModifiedError,
  type SessionModifiedError,
} from '@/application/use-cases/session-save-conflict';

export type DeleteSessionSetError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | SessionModifiedError
  | SessionMutationError;

export interface DeleteSessionSetInput {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
}

export class DeleteSessionSetUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: DeleteSessionSetInput,
  ): Promise<Result<WorkoutSessionDto, DeleteSessionSetError>> {
    const idResult = createWorkoutSessionId(input.sessionId);
    if (!idResult.ok) {
      return err({ code: 'INVALID_INPUT', message: idResult.error.message, field: 'sessionId' });
    }

    const session = await this.sessionRepository.findById(idResult.data);
    if (session === null) {
      return err({
        code: 'SESSION_NOT_FOUND',
        sessionId: input.sessionId,
        message: `Session "${input.sessionId}" not found`,
      });
    }

    const domainInput: DeleteSetInput = {
      exerciseOrder: input.exerciseOrder,
      setNumber: input.setNumber,
    };

    const result = deleteSessionSet(session, domainInput);
    if (!result.ok) {
      return result;
    }

    // Saving is a compare-and-swap on the revision this session was loaded at: if
    // another request stored this set in the meantime, nothing is written and the
    // caller is asked to reload instead of losing the other request's work.
    const saved = await this.sessionRepository.save(result.data);
    if (!saved.ok) {
      return err(toSessionModifiedError(saved.error, input.sessionId));
    }

    return ok(toWorkoutSessionDto({ ...result.data, version: saved.data }));
  }
}