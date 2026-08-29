/**
 * Builds the canonical session route path from submitted form data.
 *
 * Server Actions use it both as the post-login redirect target for
 * unauthenticated callers and as the revalidation target after a successful
 * mutation. It returns null when the route coordinates are missing or
 * invalid, so callers fall back to a safe default instead of redirecting to
 * or revalidating a bogus path.
 *
 * There is deliberately no program-path builder here: after completing a
 * session, the owning program page is derived from trusted server-side data
 * (see CompleteWorkoutSessionUseCase), not from form fields.
 */

import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/sessions/schemas/session-actions-schema';

/**
 * The nested session route as a dynamic template, paired with the 'page'
 * revalidation type in callers.
 *
 * `revalidatePath` only takes effect on a dynamic route when given the route
 * template plus a type, and `revalidatePath(template, 'page')` invalidates
 * every concrete URL matching the template. Enrollment actions revalidate
 * this because their forms carry only the program slug, while a session page
 * can be open for any week/workout of that program and must stop showing its
 * stale join prompt the moment enrollment state changes.
 */
export const SESSION_PAGE_PATH_TEMPLATE =
  '/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session';

export function sessionPathFromFormData(formData: FormData): string | null {
  const slug = programSlugSchema.safeParse(formData.get('programSlug'));
  const week = weekNumberSchema.safeParse(formData.get('weekNumber'));
  const order = workoutOrderSchema.safeParse(formData.get('workoutOrder'));
  if (!slug.success || !week.success || !order.success) {
    return null;
  }

  return `/programs/${slug.data}/weeks/${week.data}/workouts/${order.data}/session`;
}
