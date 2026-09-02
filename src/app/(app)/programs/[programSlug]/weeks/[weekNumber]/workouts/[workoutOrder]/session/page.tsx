import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { requireUser } from '@/features/auth/current-user';
import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/programs/schemas/program-routes-schema';
import { buildActiveWorkoutView } from '@/features/sessions/active-workout-view';
import { ActiveWorkoutScreen } from '@/features/sessions/components/ActiveWorkoutScreen';
import { SessionCompletedPanel } from '@/features/sessions/components/SessionCompletedPanel';
import { SessionJoinPanel } from '@/features/sessions/components/SessionJoinPanel';
import { SessionStartPanel } from '@/features/sessions/components/SessionStartPanel';

interface Props {
  readonly params: Promise<{
    readonly programSlug: string;
    readonly weekNumber: string;
    readonly workoutOrder: string;
  }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { programSlug, weekNumber, workoutOrder } = await params;
  const weekResult = weekNumberSchema.safeParse(weekNumber);
  const orderResult = workoutOrderSchema.safeParse(workoutOrder);
  const slugResult = programSlugSchema.safeParse(programSlug);
  if (!slugResult.success || !weekResult.success || !orderResult.success) {
    return { title: 'Session not found' };
  }

  // Metadata resolution uses the public occurrence only — no session state
  // or personalization belongs in the document title.
  const result = await getScheduledWorkoutUseCase.execute({
    programSlug: slugResult.data,
    weekNumber: weekResult.data,
    workoutOrder: orderResult.data,
  });
  if (!result.ok) {
    return { title: 'Session not found' };
  }
  return { title: `${result.data.workout.name} - Session` };
}

export default async function SessionPage({ params }: Props) {
  const { programSlug: rawSlug, weekNumber: rawWeek, workoutOrder: rawOrder } = await params;

  const slugResult = programSlugSchema.safeParse(rawSlug);
  const weekResult = weekNumberSchema.safeParse(rawWeek);
  const orderResult = workoutOrderSchema.safeParse(rawOrder);
  if (!slugResult.success || !weekResult.success || !orderResult.success) {
    notFound();
  }

  const ps = slugResult.data;
  const wn = weekResult.data;
  const wo = orderResult.data;

  // Sessions are user-owned: this page and its mutations require auth, and
  // the session is resolved through the user's enrollment in the program.
  const user = await requireUser(`/programs/${ps}/weeks/${wn}/workouts/${wo}/session`);

  const view = await buildActiveWorkoutView(
    { programSlug: ps, weekNumber: wn, workoutOrder: wo },
    user,
  );
  if (view === null) {
    notFound();
  }

  return (
    <PageContainer className="pb-6 md:pb-20">
      {view.screenState === 'not-enrolled' ? (
        <SessionJoinPanel
          workout={view.workout}
          programSlug={ps}
          weekNumber={wn}
          workoutOrder={wo}
        />
      ) : view.screenState === 'not-started' ? (
        <SessionStartPanel
          workout={view.workout}
          programSlug={ps}
          weekNumber={wn}
          workoutOrder={wo}
        />
      ) : view.screenState === 'completed' && view.session !== null && view.progress !== null ? (
        <SessionCompletedPanel
          workout={view.workout}
          session={view.session}
          cards={view.cards}
          progress={view.progress}
          programSlug={ps}
          weekNumber={wn}
          workoutOrder={wo}
        />
      ) : (
        <ActiveWorkoutScreen
          view={view}
          programSlug={ps}
          weekNumber={wn}
          workoutOrder={wo}
        />
      )}
    </PageContainer>
  );
}
