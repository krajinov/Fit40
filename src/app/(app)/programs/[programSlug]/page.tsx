import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import { getCurrentUser } from '@/features/auth/current-user';
import { getProgramEnrollmentUseCase } from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';
import { buildNextWorkoutView } from '@/features/sessions/next-workout-view';

interface ProgramDetailPageProps {
  readonly params: Promise<{ readonly programSlug: string }>;
}

const getProgram = cache(async (programSlug: string) => {
  return getProgramBySlugUseCase.execute(programSlug);
});

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
  let nextWorkout: Awaited<ReturnType<typeof buildNextWorkoutView>> = null;
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
    // anonymous and not-enrolled visitors get no up-next data.
    if (enrollment.status === 'enrolled' && enrollment.nextWorkout !== null) {
      nextWorkout = await buildNextWorkoutView({
        userId: user.id,
        programSlug: result.data.program.slug,
        weekNumber: enrollment.nextWorkout.weekNumber,
        workoutOrder: enrollment.nextWorkout.workoutOrder,
      });
    }
  }

  return (
    <PageContainer className="pt-10 md:pt-10">
      <ProgramDetail
        program={result.data.detail}
        enrollment={enrollment}
        nextWorkout={nextWorkout}
      />
    </PageContainer>
  );
}
