import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';
import { requireUser } from '@/features/auth/current-user';
import { lookupScheduledWorkout } from '@/features/programs/scheduled-workout-lookup';
import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/programs/schemas/program-routes-schema';
import { buildActiveWorkoutView } from '@/features/sessions/active-workout-view';
import { ActiveWorkoutScreen } from '@/features/sessions/components/ActiveWorkoutScreen';
import { SessionCompletedPanel } from '@/features/sessions/components/SessionCompletedPanel';
import { SessionJoinPanel } from '@/features/sessions/components/SessionJoinPanel';
import { SessionRecordedPanel } from '@/features/sessions/components/SessionRecordedPanel';
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
  // or personalization belongs in the document title. The lookup is
  // request-cached: generateMetadata and the page share ONE scheduled-workout
  // execution per request (see scheduled-workout-lookup).
  const result = await lookupScheduledWorkout(slugResult.data, weekResult.data, orderResult.data);
  if (!result.ok) {
    return { title: 'Session not found' };
  }
  return { title: `${result.data.workout.name} - Session` };
}

/**
 * M19 S2 review fix: parameter validation, authentication and the occurrence
 * existence check all run BEFORE this page returns any JSX, and no segment
 * `loading.tsx` exists in the chain (this boundary used to be inherited from
 * the program-detail segment as well) — so signed-out cold requests receive a
 * native 307 and unknown occurrences a native 404, instead of a streamed 200.
 * Only the active-workout view assembly streams.
 */
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

  // Existence pre-check (M19 S2 review): buildActiveWorkoutView returns null
  // ONLY when this lookup fails (its documented contract), and the lookup is
  // request-cached and already executed by generateMetadata — so checking it
  // here keeps the 404 native without a second database read.
  const workoutResult = await lookupScheduledWorkout(ps, wn, wo);
  if (!workoutResult.ok) {
    notFound();
  }

  const viewPromise = buildActiveWorkoutView(
    { programSlug: ps, weekNumber: wn, workoutOrder: wo },
    user,
  );

  return (
    <Suspense
      fallback={
        <PageContainer className="pb-6 md:pb-20">
          <RoutePlaceholder
            label="Loading workout session"
            blocks={['h-6 w-56 max-w-full', 'h-10 w-72 max-w-full', 'h-32', 'h-44', 'h-44', 'h-40']}
          />
        </PageContainer>
      }
    >
      <SessionContent
        viewPromise={viewPromise}
        programSlug={ps}
        weekNumber={wn}
        workoutOrder={wo}
      />
    </Suspense>
  );
}

interface SessionContentProps {
  readonly viewPromise: ReturnType<typeof buildActiveWorkoutView>;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

async function SessionContent({
  viewPromise,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionContentProps) {
  const ps = programSlug;
  const wn = weekNumber;
  const wo = workoutOrder;

  const view = await viewPromise;
  // Unreachable — the page's lookup pre-check above covers the only null path.
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
      ) : view.screenState === 'not-performed' ? (
        <SessionRecordedPanel
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
          programCompletion={view.programCompletion}
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
