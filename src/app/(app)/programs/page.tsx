import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { getCurrentUser } from '@/features/auth/current-user';
import { listUserEnrollmentsUseCase } from '@/features/enrollment/services';
import { listProgramsUseCase } from '@/features/programs/services';
import { ProgramList } from '@/features/programs/components/ProgramList';

export const metadata: Metadata = {
  title: 'Training Programs',
};

export default async function ProgramsPage() {
  const programs = await listProgramsUseCase.execute();

  // Catalog browsing is public; joined markers are resolved only for
  // authenticated visitors, scoped to their user id from the session.
  const user = await getCurrentUser();
  const enrollments = user === null ? [] : await listUserEnrollmentsUseCase.execute(user.id);
  const enrolledProgramIds = new Set(enrollments.map((enrollment) => enrollment.programId));

  return (
    <PageContainer className="pt-10 md:pt-10">
      <header className="mb-8 space-y-2">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          Training Programs
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          Browse structured training programs designed for adults 40+. Each
          program includes a weekly schedule of progressive workouts.
        </p>
      </header>

      <ProgramList programs={programs} enrolledProgramIds={enrolledProgramIds} />
    </PageContainer>
  );
}
