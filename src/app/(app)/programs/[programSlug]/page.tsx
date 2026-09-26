import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ScheduleReadState } from '@/application/dto/schedule';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { getCurrentUser } from '@/features/auth/current-user';
import { getProgramEnrollmentUseCase } from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';
import { getEnrollmentScheduleUseCase } from '@/features/schedule/services';
import {
  buildNextWorkoutView,
  nextWorkoutPreviewState,
  type NextWorkoutPreviewState,
} from '@/features/sessions/next-workout-view';

interface ProgramDetailPageProps {
  readonly params: Promise<{ readonly programSlug: string }>;
}

const getProgram = cache(async (programSlug: string) => {
  return getProgramBySlugUseCase.execute(programSlug);
});

/**
 * Reads the run's M15 schedule at the server boundary with the page's single
 * request clock and the SAME program aggregate the page already hydrated — no
 * second catalog lookup. Failure degrades to `{ status: 'unavailable' }`,
 * never to "unconfigured": the read is additive, so a failure must not take
 * down program detail, and per docs/error-handling.md a caught error is
 * always logged. A `null` DTO means the enrollment vanished between this
 * page's own reads (a concurrent leave) — also reported as unavailable, not
 * as an unconfigured run (the Slice 5 convention).
 */
async function readEnrollmentSchedule(
  userId: string,
  program: TrainingProgram,
  now: Date,
): Promise<ScheduleReadState> {
  try {
    const result = await getEnrollmentScheduleUseCase.execute({ userId, program, now });
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
      const workout =
        enrollment.nextWorkout === null
          ? null
          : await buildNextWorkoutView({
              userId: user.id,
              programSlug: result.data.program.slug,
              weekNumber: enrollment.nextWorkout.weekNumber,
              workoutOrder: enrollment.nextWorkout.workoutOrder,
            });
      nextWorkoutPreview = nextWorkoutPreviewState(enrollment.nextWorkout, workout);

      // M15 (Slice 6): one server-owned request clock, captured here at the
      // page boundary and passed to the schedule read — application/domain
      // logic never creates its own clock, and no client input is accepted.
      // A COMPLETED run (nextWorkout null) never reads planning: the M14
      // completion surface stays the only lifecycle state shown, and the page
      // passes schedule = null so no scheduling section renders (Slice 5
      // precedent). Not-enrolled and anonymous visitors likewise never read.
      if (enrollment.nextWorkout !== null) {
        const now = new Date();
        schedule = await readEnrollmentSchedule(user.id, result.data.program, now);
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
      />
    </PageContainer>
  );
}
