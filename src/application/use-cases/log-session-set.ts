 /**
 * Use case: log a new set in an in-progress workout session.
 */

import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
  type WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { logSessionSet, type LogSetCommandInput, type SessionMutationError, type WorkoutSession } from '@/domain/entities/workout-session';
import {
  isValidExpectedSessionVersion,
  rejectStaleRenderedIntent,
} from '@/application/use-cases/session-version-guard';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type LogSessionSetError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  | SessionMutationError;

export interface LogSessionSetInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  /**
   * The session `version` of the snapshot the caller rendered (PR #13
   * Finding 1): compared against the freshly loaded aggregate BEFORE
   * `exerciseOrder` is interpreted, so a tab rendered before a concurrent
   * reorder cannot log a set onto the occurrence that now occupies its old
   * order.
   */
  readonly expectedSessionVersion: number;
  readonly type: 'reps';
  readonly reps: number;
  readonly weightKg: number | null;
  readonly rpe: number | null;
}

export interface LogSessionDurationSetInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  /** Same stale-rendered-intent guard as the reps variant. */
  readonly expectedSessionVersion: number;
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

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
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

    // Stale rendered intent (PR #13 Finding 1): reject BEFORE interpreting
    // the mutable `exerciseOrder` — the current occupant stays untouched.
    const versionCheck = rejectStaleRenderedIntent(input.expectedSessionVersion, session);
    if (!versionCheck.ok) {
      return err(versionCheck.error);
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