'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/features/auth/current-user';
import { enrollmentFormSchema } from '@/features/enrollment/schemas/enrollment-actions-schema';
import { restartProgramUseCase } from '@/features/enrollment/services';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';
import {
  SESSION_PAGE_PATH_TEMPLATE,
  WORKOUT_PAGE_PATH_TEMPLATE,
} from '@/features/sessions/session-path';

/**
 * Restarts the authenticated user's completed program run.
 *
 * The UserId comes exclusively from the trusted session — any userId field in
 * the form data is ignored by design — and the form carries only the program
 * slug: the expected old EnrollmentId never crosses the client boundary (the
 * use case reads the current enrollment itself for its atomic replace).
 * Expected failures are returned as typed action state; unexpected errors
 * propagate to the error boundary. On success every view the restart affects
 * is revalidated — the catalog, the program detail, the completion page being
 * left, the dashboard, and nested session routes by template — and the user
 * is redirected to the program detail, never back to the completed page.
 */
export async function restartProgramAction(
  formData: FormData,
): Promise<EnrollmentActionState> {
  const user = await requireUser(completedRedirectTarget(formData));

  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid program.' } };
  }

  const result = await restartProgramUseCase.execute({
    userId: user.id,
    programSlug: parsed.data.programSlug,
  });
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: restartErrorMessage(result) } };
  }

  revalidatePath('/programs');
  revalidatePath(`/programs/${parsed.data.programSlug}`);
  revalidatePath(`/programs/${parsed.data.programSlug}/completed`);
  revalidatePath('/dashboard');
  // Both nested occurrence-route templates: the restart deletes the old run's
  // recorded facts and detaches its sessions, so a previously visited
  // workout-detail route must stop showing "Recorded as not performed" + Undo
  // (which would hide the fresh run's now-valid Start) alongside its session
  // route, exactly as the join/leave actions invalidate us.
  revalidatePath(WORKOUT_PAGE_PATH_TEMPLATE, 'page');
  revalidatePath(SESSION_PAGE_PATH_TEMPLATE, 'page');

  redirect(`/programs/${parsed.data.programSlug}`);
}

/**
 * Resolves the post-login redirect target for unauthenticated callers: the
 * completion page (where this form lives) when the submitted slug is
 * well-formed, the catalog otherwise.
 */
function completedRedirectTarget(formData: FormData): string {
  const parsed = enrollmentFormSchema.safeParse({ programSlug: formData.get('programSlug') });
  return parsed.success
    ? `/programs/${parsed.data.programSlug}/completed`
    : '/programs';
}

/**
 * Presentation copy for a restart refusal (M17 Slice 11).
 *
 * The Application error CODE stays exactly `PROGRAM_NOT_COMPLETE` (no new
 * vocabulary), but its M14 wording — "not complete yet, so it cannot be
 * restarted" — is now false: since Slice 10 a run restarts when it is
 * complete **or** concluded, so this code can only reach us for a run that is
 * still open. The action therefore states that truth instead, and passes every
 * other outcome's own message through unchanged.
 */
function restartErrorMessage(result: { readonly error: { readonly code: string; readonly message: string } }): string {
  return result.error.code === 'PROGRAM_NOT_COMPLETE'
    ? "This run hasn't finished yet."
    : result.error.message;
}