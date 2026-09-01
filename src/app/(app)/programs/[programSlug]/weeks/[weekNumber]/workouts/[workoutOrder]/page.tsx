import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { getCurrentUser } from '@/features/auth/current-user';
import { buildWorkoutDetailView } from '@/features/sessions/workout-detail-view';
import { WorkoutDetail } from '@/features/sessions/components/WorkoutDetail';
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

export async function generateMetadata({
  params,
}: ScheduledWorkoutPageProps): Promise<Metadata> {
  const { programSlug, weekNumber, workoutOrder } = await params;
  const weekResult = weekNumberSchema.safeParse(weekNumber);
  const orderResult = workoutOrderSchema.safeParse(workoutOrder);

  if (!weekResult.success || !orderResult.success) {
    return { title: 'Workout not found' };
  }

  const slugResult = programSlugSchema.safeParse(programSlug);
  if (!slugResult.success) {
    return { title: 'Workout not found' };
  }

  const view = await buildWorkoutDetailView(
    {
      programSlug: slugResult.data,
      weekNumber: weekResult.data,
      workoutOrder: orderResult.data,
    },
    // Metadata needs no personalization — recommendations are user-specific
    // and never belong in the document title.
    null,
  );

  if (view === null) {
    return { title: 'Workout not found' };
  }

  return { title: view.workout.workout.name };
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

  // The workout detail page is intentionally public: anonymous visitors can
  // browse name, exercises, prescriptions, equipment and rest. Progressive
  // overload recommendations are user-specific and only resolved for an
  // authenticated visitor (never another user's history).
  const user = await getCurrentUser();

  const view = await buildWorkoutDetailView(
    {
      programSlug: slugResult.data,
      weekNumber: weekResult.data,
      workoutOrder: orderResult.data,
    },
    user,
  );

  if (view === null) {
    notFound();
  }

  return (
    <PageContainer className="pt-5 pb-6 md:pt-10 md:pb-20">
      <WorkoutDetail view={view} />
    </PageContainer>
  );
}
