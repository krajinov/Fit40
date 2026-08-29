/**
 * Boundary validation for enrollment Server Actions.
 *
 * The only client-supplied field is the program slug. The user id is NEVER
 * accepted from form data — it comes from the authenticated session.
 */

import { z } from 'zod';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const enrollmentFormSchema = z.object({
  programSlug: z.string().regex(SLUG_PATTERN),
});
