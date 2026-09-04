/**
 * Boundary validation for the per-exercise history route: the dynamic
 * `[slug]` path segment. Mirrors the domain slug rule (kebab-case) via the
 * same pattern as the exercise-detail page; anything more specific
 * (existence) is resolved by the use case against the database, never by
 * the schema.
 */

import { z } from 'zod';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const exerciseHistoryParamsSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
});

export type ExerciseHistoryParams = z.infer<typeof exerciseHistoryParamsSchema>;
