/**
 * Boundary validation for the completed-session detail route: the dynamic
 * `[sessionId]` path segment. Mirrors the domain id rule (non-empty string);
 * anything more specific (existence, ownership, completed state) is resolved
 * by the use case against the database, never by the schema.
 */

import { z } from 'zod';

export const completedSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

export type CompletedSessionParams = z.infer<typeof completedSessionParamsSchema>;
