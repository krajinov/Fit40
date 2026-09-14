/**
 * Use case: mark one exercise occurrence as skipped in an in-progress
 * workout session (M10).
 *
 * Same guard chain as substitution/restore (validate → load → ownership →
 * enrollment → domain → optimistic-concurrency save), minus any catalog
 * lookup: skipping never changes which exercise is performed, so no catalog
 * read is needed. Every skip invariant (immutability at completion,
 * occurrence existence, logged-set block, no-change) is delegated to the
 * domain service and never duplicated here.
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
import type { WorkoutSession } from '@/domain/entities/workout-session';
import type { SessionAdjustmentError } from '@/domain/services/occurrence-adjustment-rules';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  isValidExpectedSessionVersion,
  rejectStaleRenderedIntent,
} from '@/application/use-cases/session-version-guard';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type SkipSessionExerciseError =
  | { readonly code: 'SESSION_NOT_FOUND'; readonly sessionId: string; readonly message: string }
  | { readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly code: 'NOT_ENROLLED'; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string }
  | { readonly code: 'SESSION_MODIFIED'; readonly message: string }
  // The domain service's expected adjustment failures (completed session,
  // unknown occurrence, logged-set block, no-change) surface with their own
  // codes — the skip invariants stay owned by the domain.
  | SessionAdjustmentError;

export interface SkipSessionExerciseInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly exerciseOrder: number;
  /**
   * The session `version` of the snapshot the caller rendered (PR #13
   * Finding 1): compared against the freshly loaded aggregate BEFORE
   * `exerciseOrder` is interpreted, so a tab rendered before a concurrent
   * reorder cannot skip the occurrence that now occupies its old order.
   */
  readonly expectedSessionVersion: number;
}

export class SkipSessionExerciseUseCase {
  constructor(private readonly sessionRepository: WorkoutSessionRepository) {}

  async execute(
    input: SkipSessionExerciseInput,
  ): Promise<Result<WorkoutSessionDto, SkipSessionExerciseError>> {
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

    // Stale rendered intent (PR #13 Finding 1): the caller rendered version V;
    // the loaded aggregate is on a different version, so `exerciseOrder` may
    // identify a different occurrence after a concurrent reorder. Reject
    // BEFORE interpreting the order — the current occupant stays untouched.
    const versionCheck = rejectStaleRenderedIntent(input.expectedSessionVersion, session);
    if (!versionCheck.ok) {
      return err(versionCheck.error);
    }

    const result = skipSessionExercise(session, { exerciseOrder: input.exerciseOrder });
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