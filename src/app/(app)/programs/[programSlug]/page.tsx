import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import type { EnrollmentFollowThroughDto } from '@/application/dto/follow-through';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { ScheduleReadState } from '@/application/dto/schedule';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { getCurrentUser } from '@/features/auth/current-user';
import {
  getProgramEnrollmentUseCase,
  getRunClosureSummaryUseCase,
} from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';
import {
  getEnrollmentFollowThroughUseCase,
  getEnrollmentScheduleUseCase,
} from '@/features/schedule/services';
import {
  buildNextWorkoutView,
  nextWorkoutPreviewState,
  type NextWorkoutPreviewState,
} from '@/features/sessions/next-workout-view';
import { resolveRunNextOccurrence } from '@/features/enrollment/next-occurrence';

interface ProgramDetailPageProps {
  readonly params: Promise<{ readonly programSlug: string }>;
}

const getProgram = cache(async (programSlug: string) => {
  return getProgramBySlugUseCase.execute(programSlug);
});

/**
 * Reads the run's M15 schedule at the server boundary with the page's single
 * request clock, the SAME program aggregate the page already hydrated, AND the
 * SAME enrollment the page already loaded - no second catalog lookup, and
 * never a re-resolved current enrollment: the read is fenced to that exact
 * generation (`expectedEnrollmentId`), so a concurrent restart/leave cannot
 * compose this page's old-enrollment view with a new run's calendar. Failure -
 * including the typed `ENROLLMENT_CHANGED` refusal - degrades to
 * `{ status: 'unavailable' }`, never to "unconfigured": the read is additive,
 * so a failure or stale generation must not take down program detail, and per
 * docs/error-handling.md a caught error is always logged. A `null` DTO means
 * the enrollment vanished between this page's own reads (a concurrent leave) -
 * also reported as unavailable, not as an unconfigured run (the Slice 5
 * convention).
 */
async function readEnrollmentSchedule(
  userId: string,
  program: TrainingProgram,
  now: Date,
  expectedEnrollmentId: string,
): Promise<ScheduleReadState> {
  try {
    const result = await getEnrollmentScheduleUseCase.execute({
      userId,
      program,
      now,
      expectedEnrollmentId,
    });
    if (!result.ok) {
      console.error(
        `Unexpected failure reading the training schedule for program "${program.slug}"`,
        result.error,
      );
      return { status: 'unavailable' };
    }
    if (result.data === null) {
      console.error(
        `Training schedule for program "${program.slug}" became unreadable: the enrollment no longer exists`,
      );
      return { status: 'unavailable' };
    }
    return { status: 'loaded', schedule: result.data };
  } catch (error: unknown) {
    console.error(
      `Unexpected failure reading the training schedule for program "${program.slug}"`,
      error,
    );
    return { status: 'unavailable' };
  }
}

/**
 * Reads the run's M17 closure summary (Slice 10) with the SAME already-hydrated
 * program aggregate — no second catalog lookup and no request clock: conclusion
 * is not a date consequence, so this read deliberately takes no `now`.
 *
 * The summary is loaded for EVERY enrolled run — complete, concluded-but-
 * incomplete or open — because it is factual state, not a rendered one (Slice
 * 11 renders from it; this page exposes the DTO only). It is additive and
 * read-only, so a failure (or a `null` DTO, meaning the enrollment vanished
 * between this page's own reads) is logged and passed on as null: never a
 * fabricated summary, and never a reason to take down program detail.
 */
async function readRunClosure(
  userId: string,
  program: TrainingProgram,
  expectedEnrollmentId: string,
): Promise<RunClosureSummaryDto | null> {
  try {
    // Fenced to the enrollment the page already loaded: a concurrent restart
    // cannot compose this page's old-enrollment view with a new run's closure.
    const result = await getRunClosureSummaryUseCase.execute({
      userId,
      program,
      expectedEnrollmentId,
    });
    if (!result.ok) {
      console.error(
        `Unexpected failure reading the run closure summary for program "${program.slug}"`,
        result.error,
      );
      return null;
    }
    if (result.data === null) {
      console.error(
        `Run closure summary for program "${program.slug}" became unreadable: the enrollment no longer exists`,
      );
      return null;
    }
    return result.data;
  } catch (error: unknown) {
    console.error(
      `Unexpected failure reading the run closure summary for program "${program.slug}"`,
      error,
    );
    return null;
  }
}

/**
 * Reads the run's M16 plan follow-through at the server boundary with the SAME
 * request clock and the SAME already-hydrated program aggregate the schedule
 * read uses — no second catalog lookup. The section is additive, so this
 * follows the page's existing section-read behavior: a failure - including
 * the typed `ENROLLMENT_CHANGED` refusal - (or a `null` DTO, meaning the
 * enrollment vanished between this page's own reads) is logged and renders no
 * section. It is never turned into `configured: false`,
 * an empty report or fabricated weeks, and not-enrolled is simply no section —
 * expected absence is data, an unexpected failure is still logged as a failure.
 */
async function readEnrollmentFollowThrough(
  userId: string,
  program: TrainingProgram,
  now: Date,
  expectedEnrollmentId: string,
): Promise<EnrollmentFollowThroughDto | null> {
  try {
    // Fenced to the enrollment the page already loaded - never a re-resolved
    // current enrollment - so a concurrent restart/leave cannot compose this
    // page's view with a new run's report.
    const result = await getEnrollmentFollowThroughUseCase.execute({
      userId,
      program,
      now,
      expectedEnrollmentId,
    });
    if (!result.ok) {
      console.error(
        `Unexpected failure reading plan follow-through for program "${program.slug}"`,
        result.error,
      );
      return null;
    }
    if (result.data === null) {
      console.error(
        `Plan follow-through for program "${program.slug}" became unreadable: the enrollment no longer exists`,
      );
      return null;
    }
    return result.data;
  } catch (error: unknown) {
    console.error(
      `Unexpected failure reading plan follow-through for program "${program.slug}"`,
      error,
    );
    return null;
  }
}

export async function generateMetadata({
  params,
}: ProgramDetailPageProps): Promise<Metadata> {
  const { programSlug } = await params;
  const result = await getProgram(programSlug);

  if (!result.ok) {
    return { title: 'Program not found' };
  }

  return { title: result.data.detail.name };
}

export default async function ProgramDetailPage({
  params,
}: ProgramDetailPageProps) {
  const { programSlug } = await params;

  const slugResult = programSlugSchema.safeParse(programSlug);
  if (!slugResult.success) {
    notFound();
  }

  const result = await getProgram(programSlug);
  if (!result.ok) {
    notFound();
  }

  // The catalog page stays public; enrollment state is resolved only for
  // authenticated visitors, scoped to their user id from the session.
  const user = await getCurrentUser();
  let enrollment: ProgramEnrollmentViewDto | null = null;
  let nextWorkoutPreview: NextWorkoutPreviewState | null = null;
  let schedule: ScheduleReadState | null = null;
  let followThrough: EnrollmentFollowThroughDto | null = null;
  let runClosure: RunClosureSummaryDto | null = null;
  if (user !== null) {
    const enrollmentResult = await getProgramEnrollmentUseCase.execute({
      userId: user.id,
      program: result.data.program,
    });
    if (!enrollmentResult.ok) {
      // Unreachable in practice (the user id comes from the trusted session
      // and only INVALID_INPUT can fail): treat as an unexpected failure.
      throw new Error(
        `Failed to resolve enrollment for program "${result.data.program.slug}": ${enrollmentResult.error.message}`,
      );
    }
    enrollment = enrollmentResult.data;

    // Resolve the next workout's session state only for enrolled users;
    // anonymous and not-enrolled visitors get no up-next data. An enrolled
    // user whose scheduled next workout cannot be previewed degrades to the
    // "unavailable" state — never to "completed" — and no workout data is
    // fabricated.
    if (enrollment.status === 'enrolled') {
      // M17 (Slice 10): the run's closure truth — counts plus the complete /
      // concluded / open verdicts — for EVERY enrolled run. It is a factual
      // read, not a lifecycle surface: no clock, no calendar, no `nextWorkout`
      // precondition, and nothing rendered from it yet (Slice 11 does), so the
      // M14 completion surface stays the only lifecycle state shown today.
      runClosure = await readRunClosure(user.id, result.data.program, enrollment.enrollmentId);

      // M17 (Slice 11): the up-next affordance follows the run's AUTHORITATIVE
      // next occurrence — the closure-resolved FIRST OPEN authored occurrence
      // when the closure read supplied it — never merely the first occurrence
      // without a completed session, which can be a recorded-not-performed
      // settlement that must not be offered a Start. The preview is resolved for
      // that occurrence with the page's existing single resolve call (no new DB
      // read); a null closure DTO degrades to the M14 next workout exactly as
      // before.
      const nextOccurrence = resolveRunNextOccurrence(enrollment.nextWorkout, runClosure);
      const workout =
        nextOccurrence === null
          ? null
          : await buildNextWorkoutView({
              userId: user.id,
              programSlug: result.data.program.slug,
              weekNumber: nextOccurrence.weekNumber,
              workoutOrder: nextOccurrence.workoutOrder,
              // The preview is fenced to the SAME enrollment generation as the
              // schedule, follow-through and closure reads on this page.
              expectedEnrollmentId: enrollment.enrollmentId,
            });
      nextWorkoutPreview = nextWorkoutPreviewState(nextOccurrence, workout);

      // M15 (Slice 6) + M16 (Slice 5): one server-owned request clock,
      // captured here at the page boundary and shared by both section reads —
      // application/domain logic never creates its own clock, no client input
      // is accepted, and both reads agree on `today`. A COMPLETED run
      // (nextWorkout null) never reads either: the M14 completion surface stays
      // the only lifecycle state shown, and the page passes null so no
      // scheduling or follow-through section renders. Not-enrolled and
      // anonymous visitors likewise never read.
      //
      // The two section reads are independent — neither decides whether the
      // other should happen — so they are issued together rather than
      // serialized. The enrollment read above stays sequential on purpose: it
      // is the authority that gates them.
      if (enrollment.nextWorkout !== null) {
        const now = new Date();
        const [scheduleState, followThroughResult] = await Promise.all([
          // BOTH section reads are fenced to the SAME enrollment generation
          // the page already loaded - the same fence the closure read uses - so
          // no nested read can silently describe the replacement run while
          // this view still describes the loaded one.
          readEnrollmentSchedule(user.id, result.data.program, now, enrollment.enrollmentId),
          readEnrollmentFollowThrough(user.id, result.data.program, now, enrollment.enrollmentId),
        ]);
        schedule = scheduleState;
        followThrough = followThroughResult;
      }
    }
  }

  return (
    <PageContainer className="pt-10 md:pt-10">
      <ProgramDetail
        program={result.data.detail}
        enrollment={enrollment}
        nextWorkoutPreview={nextWorkoutPreview}
        schedule={schedule}
        followThrough={followThrough}
        runClosure={runClosure}
      />
    </PageContainer>
  );
}
