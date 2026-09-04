/**
 * Use case: lifetime training totals of the authenticated user.
 *
 * Read-only and deliberately minimal: only plain database aggregates
 * (COUNT) over completed sessions and their logged sets — per-session
 * metrics are the DTO mapper's job in the application layer, never SQL.
 * The userId must come from the trusted authenticated session at the
 * presentation layer, never from client input.
 */

import type { TrainingTotalsDto } from '@/application/dto/training-history';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetTrainingTotalsError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
};

export class GetTrainingTotalsUseCase {
  constructor(private readonly historyRepository: TrainingHistoryRepository) {}

  async execute(userId: string): Promise<Result<TrainingTotalsDto, GetTrainingTotalsError>> {
    const userIdResult = createUserId(userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const totals = await this.historyRepository.getTotals(userIdResult.data);
    return ok(totals);
  }
}
