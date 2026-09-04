/**
 * URL search-parameter boundary for the training-history page.
 *
 * Structural problems (missing, empty, or array-valued cursor) fall back to
 * the first page, mirroring the exercise-filters convention that a malformed
 * query string never crashes the page. A structurally valid cursor that
 * fails semantic validation (tampered or stale token) is rejected by
 * ListTrainingHistoryUseCase as INVALID_INPUT and handled by the page.
 */

import { z } from 'zod';

const historyCursorSchema = z.string().min(1);

export interface HistoryPageQuery {
  readonly cursor: string | null;
}

/**
 * Extracts the opaque history cursor from raw URL search params, or null
 * when the request addresses the first page (or the param is malformed).
 */
export function parseHistoryPageQuery(
  searchParams: Record<string, string | string[] | undefined>,
): HistoryPageQuery {
  const result = historyCursorSchema.safeParse(searchParams.cursor);
  return { cursor: result.success ? result.data : null };
}
