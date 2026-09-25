/**
 * M14 program-complete surfacing for the Session Completed screen (Slice 7).
 *
 * Resolves ONE optional presentation fact — whether the just-completed
 * session's CURRENT program enrollment is now complete — through the same
 * GetProgramEnrollmentUseCase that derives `nextWorkout` on the program
 * detail page (the authoritative application read; never workout-order
 * inference, never session counting in Presentation). The dedicated
 * completion summary use case is deliberately NOT introduced here: the
 * detailed summary belongs to its route.
 *
 * The caller gates this resolver on `screenState === 'completed'`, so active,
 * not-started and not-enrolled screens never pay these reads. On any typed
 * failure the optional surfacing degrades to null — mirroring how the
 * workout-detail recommendations omit themselves on failures — so an
 * unavailable read can never become a false "Program complete" claim and
 * the completed session screen stays fully usable.
 */

import { getProgramEnrollmentUseCase } from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';

/** Server-derived fact for the Session Completed program-complete callout. */
export interface SessionProgramCompletionFact {
  /** The program's display name, reused from the already-loaded workout DTO. */
  readonly programName: string;
  /** The dedicated M14 completion route. */
  readonly summaryHref: string;
}

/**
 * Returns the callout fact when (and only when) the current enrollment is
 * authoritatively complete (`status: 'enrolled'` with a null next workout);
 * null for not-enrolled, incomplete, or an unresolvable optional read.
 *
 * The enrollment use case's input contract takes the program aggregate (the
 * same hydration the program detail page reuses), so this completed-state
 * path pays one conditional catalog read plus the enrollment projection; the
 * displayed name itself comes from the caller's existing view data.
 */
export async function resolveSessionProgramCompletionFact(
  input: {
    readonly programSlug: string;
    readonly programName: string;
  },
  userId: string,
): Promise<SessionProgramCompletionFact | null> {
  const programResult = await getProgramBySlugUseCase.execute(input.programSlug);
  if (!programResult.ok) {
    // The workout resolved moments ago under the same slug; treat even this
    // unreachable miss as "no optional surfacing", never as completion.
    return null;
  }

  const enrollmentResult = await getProgramEnrollmentUseCase.execute({
    userId,
    program: programResult.data.program,
  });
  if (!enrollmentResult.ok) {
    return null;
  }

  const enrollment = enrollmentResult.data;
  if (enrollment.status !== 'enrolled' || enrollment.nextWorkout !== null) {
    return null;
  }

  return {
    programName: input.programName,
    summaryHref: `/programs/${input.programSlug}/completed`,
  };
}