/**
 * Use case: list one page of the authenticated user's training history.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input. The cursor is an opaque
 * token produced by a previous run of this use case; a token that fails
 * decoding is tampered or stale input and yields INVALID_INPUT as expected
 * error data — never an exception. Invalid inputs return before the
 * repository is touched.
 */

import {
  decodeTrainingHistoryCursor,
  encodeTrainingHistoryCursor,
  resolveTrainingHistoryLimit,
  type TrainingHistoryPageDto,
  toTrainingHistorySessionDto,
} from '@/application/dto/training-history';
import type {
  TrainingHistoryCursor,
  TrainingHistoryRepository,
} from '@/application/ports/training-history-repository';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type ListTrainingHistoryError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export interface ListTrainingHistoryInput {
  readonly userId: string;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export class ListTrainingHistoryUseCase {
  constructor(private readonly historyRepository: TrainingHistoryRepository) {}

  async execute(
    input: ListTrainingHistoryInput,
  ): Promise<Result<TrainingHistoryPageDto, ListTrainingHistoryError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const limitResult = resolveTrainingHistoryLimit(input.limit);
    if (!limitResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: limitResult.error.message,
        field: limitResult.error.field,
      });
    }

    let after: TrainingHistoryCursor | null = null;
    if (input.cursor !== undefined && input.cursor !== null) {
      const decoded = decodeTrainingHistoryCursor(input.cursor);
      if (!decoded.ok) {
        return err({
          code: 'INVALID_INPUT',
          message: decoded.error.message,
          field: 'cursor',
        });
      }
      after = decoded.data;
    }

    const page = await this.historyRepository.listCompletedSessions(userIdResult.data, {
      limit: limitResult.data,
      after,
    });

    return ok({
      sessions: page.entries.map(toTrainingHistorySessionDto),
      nextCursor: page.nextAfter === null ? null : encodeTrainingHistoryCursor(page.nextAfter),
    });
  }
}
