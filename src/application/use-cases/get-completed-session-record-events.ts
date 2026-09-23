/**
 * Use case: the historical personal-record events of ONE completed session of
 * the authenticated user, for the completed-session detail screen (M12
 * Slice 4).
 *
 * Read-only, and deliberately separate from `GetCompletedSessionUseCase`: the
 * approved M12 architecture keeps the existing completed-session contract free
 * of record semantics, so the detail screen composes the two reads and merges
 * their results.
 *
 * Pipeline (all semantics owned by Slice 1, all reads by Slice 2):
 *
 *   completed session (completed-only, user-owned read)
 *     -> extractRecordCandidates(session)            // Domain: eligibility + positions
 *     -> findBestValuesBefore(userId, candidates)    // exact best strictly before each set
 *     -> resolveRecordEvents(priorBests)             // Domain: first/strictly-greater only
 *     -> SessionRecordEventDto[]                     // position-keyed, deterministic
 *
 * Nothing here computes, approximates, or re-interprets record status: no
 * values are compared, no maxima are derived, and today's personal bests are
 * never consulted — a historical event is what was true at that point in
 * history, even when a later performance surpassed it.
 *
 * Cost note: the session is read through the same completed-session read path
 * the detail screen already uses, so a request performs that bounded,
 * fully-indexed read twice (once per use case). Sharing one read would require
 * changing the existing completed-session use case's contract or introducing a
 * reader abstraction; the duplicate is a constant number of single-session
 * queries, so this slice keeps both contracts independent instead of
 * refactoring for one read.
 *
 * Error contract (same single outcome as the completed-session read):
 * - INVALID_INPUT: a malformed userId or sessionId.
 * - SESSION_NOT_FOUND: a missing, foreign, or still-in-progress session — one
 *   outcome, no existence leak.
 * - `extractRecordCandidates` refusing a session that the completed-only read
 *   just returned is an invariant violation, not a business outcome: it
 *   throws (the repository/application convention for corrupt data) instead of
 *   degrading to "no records".
 */

import {
  toSessionRecordEventDto,
  type SessionRecordEventDto,
} from '@/application/dto/personal-records';
import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { extractRecordCandidates, resolveRecordEvents } from '@/domain/services/personal-records';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetCompletedSessionRecordEventsError = {
  readonly code: 'INVALID_INPUT' | 'SESSION_NOT_FOUND';
  readonly message: string;
  readonly field?: string;
};

export interface GetCompletedSessionRecordEventsInput {
  readonly userId: string;
  readonly sessionId: string;
}

export class GetCompletedSessionRecordEventsUseCase {
  constructor(
    private readonly historyRepository: TrainingHistoryRepository,
    private readonly personalRecordRepository: PersonalRecordRepository,
  ) {}

  async execute(
    input: GetCompletedSessionRecordEventsInput,
  ): Promise<Result<ReadonlyArray<SessionRecordEventDto>, GetCompletedSessionRecordEventsError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const sessionIdResult = createWorkoutSessionId(input.sessionId);
    if (!sessionIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: sessionIdResult.error.message,
        field: 'sessionId',
      });
    }

    const context = await this.historyRepository.findCompletedSessionById(
      userIdResult.data,
      sessionIdResult.data,
    );
    if (context === null) {
      return err({ code: 'SESSION_NOT_FOUND', message: 'Completed workout session not found' });
    }

    const extracted = extractRecordCandidates(context.session);
    if (!extracted.ok) {
      throw new Error(
        `Corrupt data in completed session (id=${sessionIdResult.data}): ${extracted.error.message}`,
      );
    }

    // A session with no logged sets (all occurrences skipped or set-less) has
    // no candidates: there is no record to look up, so the exact best-before
    // read is not issued at all.
    if (extracted.data.length === 0) {
      return ok([]);
    }

    const priorBests = await this.personalRecordRepository.findBestValuesBefore(
      userIdResult.data,
      extracted.data,
    );

    // The resolver preserves its input order, and both reads above are
    // position-ordered, so events come out in deterministic chronological
    // (exercise order, then set number) order.
    return ok(resolveRecordEvents(priorBests).map(toSessionRecordEventDto));
  }
}
