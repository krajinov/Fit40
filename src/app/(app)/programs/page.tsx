import type { Metadata } from 'next';

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
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Training Programs
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Browse structured training programs designed for adults 40+. Each
          program includes a weekly schedule of progressive workouts.
        </p>
      </div>

      <ProgramList programs={programs} enrolledProgramIds={enrolledProgramIds} />
    </main>
  );
}
