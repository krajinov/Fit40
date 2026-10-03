/**
 * Builds the canonical session route path from submitted form data.
 *
 * Server Actions use it both as the post-login redirect target for
 * unauthenticated callers and as the revalidation target after a successful
 * mutation. It returns null when the route coordinates are missing or
 * invalid, so callers fall back to a safe default instead of redirecting to
 * or revalidating a bogus path.
 *
 * Completion additionally revalidates from trusted server-side data (see
 * CompleteWorkoutSessionUseCase): programPathFromSlug and sessionPathFromRoute
 * build those targets from the use case's resolved route, never from form
 * fields.
 */

import type { SessionRoute } from '@/application/ports/program-repository';
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

/**
 * The workout-detail route as a dynamic template — the session route's parent,
 * paired with the 'page' revalidation type in callers.
 *
 * Same rationale as `SESSION_PAGE_PATH_TEMPLATE`: a form that carries only the
 * program slug cannot name a concrete occurrence, yet EVERY occurrence route of
 * that program can render settlement or enrollment state (the recorded CTA band
 * with Undo, or a stale join/Start prompt). `revalidatePath(template, 'page')`
 * invalidates every concrete URL matching the template, so a previously visited
 * workout-detail route is invalidated alongside its session route.
 */
export const WORKOUT_PAGE_PATH_TEMPLATE =
  '/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]';

export function sessionPathFromFormData(formData: FormData): string | null {
  const slug = programSlugSchema.safeParse(formData.get('programSlug'));
  const week = weekNumberSchema.safeParse(formData.get('weekNumber'));
  const order = workoutOrderSchema.safeParse(formData.get('workoutOrder'));
  if (!slug.success || !week.success || !order.success) {
    return null;
  }

  return buildSessionPath({
    programSlug: slug.data,
    weekNumber: week.data,
    workoutOrder: order.data,
  });
}

/**
 * The authored coordinates every occurrence route uses: the public program
 * slug plus the authored week number and workout order. Structurally identical
 * to `SessionRoute` on the ProgramRepository port; kept named locally so both
 * route builders below accept trusted coordinates only.
 */
interface OccurrenceRoute {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

function buildWorkoutPath(coordinates: OccurrenceRoute): string {
  return `/programs/${coordinates.programSlug}/weeks/${coordinates.weekNumber}/workouts/${coordinates.workoutOrder}`;
}

function buildSessionPath(coordinates: OccurrenceRoute): string {
  return `${buildWorkoutPath(coordinates)}/session`;
}

/**
 * The owning program page path for a trusted server-resolved slug.
 */
export function programPathFromSlug(programSlug: string): string {
  return `/programs/${programSlug}`;
}

/**
 * The canonical workout-detail route path for a trusted server-resolved
 * occurrence route (SessionRoute on the ProgramRepository port): the session
 * route's parent. That page renders the occurrence's recorded state too (the
 * CTA band's recorded branch), so a settlement change must invalidate it
 * alongside the session route. Unlike sessionPathFromFormData, its inputs can
 * never come from client fields.
 */
export function workoutPathFromRoute(route: SessionRoute): string {
  return buildWorkoutPath(route);
}

/**
 * The canonical session route path for a trusted server-resolved occurrence
 * route (SessionRoute on the ProgramRepository port). Unlike
 * sessionPathFromFormData, its inputs can never come from client fields.
 */
export function sessionPathFromRoute(route: SessionRoute): string {
  return buildSessionPath(route);
}
