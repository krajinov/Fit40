import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import { getCurrentUser } from '@/features/auth/current-user';
import { getProgramEnrollmentUseCase } from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';

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
  }

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <ProgramDetail program={result.data.detail} enrollment={enrollment} />
    </main>
  );
}
