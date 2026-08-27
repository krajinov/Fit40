 /**
 * Use case: log a new set in an in-progress workout session.
 */

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  logSessionSet,
  type LogSetCommandInput,
  type SessionMutationError,
} from '@/domain/entities/workout-session';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';
import {
  toSessionModifiedError,
  type SessionModifiedError,
} from '@/application/use-cases/session-save-conflict';

export type LogSessionSetError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | SessionModifiedError
  | SessionMutationError;

export interface LogSessionSetInput {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly type: 'reps';
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface LogSessionDurationSetInput {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly type: 'duration';
  readonly durationSeconds: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export type LogSessionSetCommandInput = LogSessionSetInput | LogSessionDurationSetInput;

export class LogSessionSetUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: LogSessionSetCommandInput,
  ): Promise<Result<WorkoutSessionDto, LogSessionSetError>> {
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

    const domainInput: LogSetCommandInput =
      input.type === 'reps'
        ? {
            exerciseOrder: input.exerciseOrder,
            type: 'reps',
            reps: input.reps,
            weightKg: input.weightKg,
            rpe: input.rpe,
          }
        : {
            exerciseOrder: input.exerciseOrder,
            type: 'duration',
            durationSeconds: input.durationSeconds,
            weightKg: input.weightKg,
            rpe: input.rpe,
          };

    const result = logSessionSet(session, domainInput);
    if (!result.ok) {
      return result;
    }

    // Saving is a compare-and-swap on the revision this session was loaded at:
    // if another request stored it in the meantime, nothing is written and the
    // caller is asked to reload instead of having that work silently overwritten.
    const saved = await this.sessionRepository.save(result.data);
    if (!saved.ok) {
      return err(toSessionModifiedError(saved.error, input.sessionId));
    }

    return ok(toWorkoutSessionDto({ ...result.data, version: saved.data }));
  }
}