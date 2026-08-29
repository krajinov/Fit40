/**
 * Builds canonical session/program route paths from submitted form data.
 *
 * Server Actions use these both as the post-login redirect target for
 * unauthenticated callers and as the revalidation targets after a successful
 * mutation. Each returns null when its route coordinates are missing or
 * invalid, so callers fall back to a safe default instead of redirecting to
 * or revalidating a bogus path.
 */

import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/sessions/schemas/session-actions-schema';

export function sessionPathFromFormData(formData: FormData): string | null {
  const slug = programSlugSchema.safeParse(formData.get('programSlug'));
  const week = weekNumberSchema.safeParse(formData.get('weekNumber'));
  const order = workoutOrderSchema.safeParse(formData.get('workoutOrder'));
  if (!slug.success || !week.success || !order.success) {
    return null;
  }

  return `/programs/${slug.data}/weeks/${week.data}/workouts/${order.data}/session`;
}

export function programPathFromFormData(formData: FormData): string | null {
  const slug = programSlugSchema.safeParse(formData.get('programSlug'));
  if (!slug.success) {
    return null;
  }

  return `/programs/${slug.data}`;
}
