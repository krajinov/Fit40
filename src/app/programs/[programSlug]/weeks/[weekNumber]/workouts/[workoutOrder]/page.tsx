import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import { ScheduledWorkoutDetail } from '@/features/programs/components/ScheduledWorkoutDetail';
import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/programs/schemas/program-routes-schema';

interface ScheduledWorkoutPageProps {
  readonly params: Promise<{
    readonly programSlug: string;
    readonly weekNumber: string;
    readonly workoutOrder: string;
  }>;
}

const getWorkout = cache(
  async (programSlug: string, weekNumber: number, workoutOrder: number) => {
    return getScheduledWorkoutUseCase.execute({
      programSlug,
      weekNumber,
      workoutOrder,
    });
  },
);

export async function generateMetadata({
  params,
}: ScheduledWorkoutPageProps): Promise<Metadata> {
  const { programSlug, weekNumber, workoutOrder } = await params;
  const weekResult = weekNumberSchema.safeParse(weekNumber);
  const orderResult = workoutOrderSchema.safeParse(workoutOrder);

  if (!weekResult.success || !orderResult.success) {
    return { title: 'Workout not found' };
  }

  const result = await getWorkout(programSlug, weekResult.data, orderResult.data);

  if (!result.ok) {
    return { title: 'Workout not found' };
  }

  return { title: result.data.workout.name };
}

export default async function ScheduledWorkoutPage({
  params,
}: ScheduledWorkoutPageProps) {
  const { programSlug, weekNumber, workoutOrder } = await params;

  const slugResult = programSlugSchema.safeParse(programSlug);
  const weekResult = weekNumberSchema.safeParse(weekNumber);
  const orderResult = workoutOrderSchema.safeParse(workoutOrder);

  if (!slugResult.success || !weekResult.success || !orderResult.success) {
    notFound();
  }

  const result = await getWorkout(
    slugResult.data,
    weekResult.data,
    orderResult.data,
  );

  if (!result.ok) {
    notFound();
  }

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <ScheduledWorkoutDetail workout={result.data} />
    </main>
  );
}