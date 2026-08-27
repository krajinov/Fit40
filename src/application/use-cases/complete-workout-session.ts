/**
 * Use case: complete an in-progress workout session.
 *
 * Sets the completion timestamp and persists the session.
 * Completed sessions are immutable thereafter.
 */

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  completeWorkoutSession,
  type SessionMutationError,
} from '@/domain/entities/workout-session';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';
import { assertSessionSaveSucceeded } from '@/application/use-cases/session-save-conflict';

export type CompleteWorkoutSessionError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | SessionMutationError;

export interface CompleteWorkoutSessionInput {
  readonly sessionId: string;
}

export class CompleteWorkoutSessionUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: CompleteWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionDto, CompleteWorkoutSessionError>> {
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

    const result = completeWorkoutSession(session, new Date());
    if (!result.ok) {
      return result;
    }

    const saved = await this.sessionRepository.save(result.data);
    assertSessionSaveSucceeded(saved, result.data.id);

    return ok(toWorkoutSessionDto(result.data));
  }
}