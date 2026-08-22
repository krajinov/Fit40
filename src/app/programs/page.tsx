import type { Metadata } from 'next';

import { listProgramsUseCase } from '@/features/programs/services';
import { ProgramList } from '@/features/programs/components/ProgramList';

export const metadata: Metadata = {
  title: 'Training Programs',
};

export default async function ProgramsPage() {
  const programs = await listProgramsUseCase.execute();

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

      <ProgramList programs={programs} />
    </main>
  );
}