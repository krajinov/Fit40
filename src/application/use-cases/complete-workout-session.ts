/**
 * Use case: complete an in-progress workout session.
 *
 * Sets the completion timestamp and persists the session.
 * Completed sessions are immutable thereafter.
 */

import type { ProgramRepository, SessionRoute } from '@/application/ports/program-repository';
import {
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import {
  completeWorkoutSession,
  type SessionMutationError,
} from '@/domain/entities/workout-session';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type CompleteWorkoutSessionError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  | SessionMutationError;

export interface CompleteWorkoutSessionInput {
  readonly sessionId: string;
  readonly userId: string;
}

/**
 * Successful completion outcome. `route` holds the owning occurrence's route
 * coordinates resolved server-side from the session's own scheduled workout —
 * never from client input — so the presentation layer revalidates the true
 * affected program page and session page. Null when the owning program no
 * longer exists, in which case there is no trustworthy page to revalidate.
 */
export interface CompletedWorkoutSessionView {
  readonly session: WorkoutSessionDto;
  readonly route: SessionRoute | null;
}

export class CompleteWorkoutSessionUseCase {
  constructor(
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly programRepository: ProgramRepository,
  ) {}

  async execute(
    input: CompleteWorkoutSessionInput,
  ): Promise<Result<CompletedWorkoutSessionView, CompleteWorkoutSessionError>> {
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

    const result = completeWorkoutSession(session, new Date());
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

    // Derive the trusted owning occurrence route from the session's own data,
    // never from client-supplied route coordinates: the revalidation targets
    // must not be forgeable via form fields.
    const route = await this.programRepository.findSessionRouteByScheduledWorkoutId(
      result.data.scheduledWorkoutId,
    );

    return ok({ session: toWorkoutSessionDto(result.data), route });
  }
}