import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import { StartSessionButton } from '@/features/sessions/components/StartSessionButton';
import Link from 'next/link';

interface SessionStartPanelProps {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Not-started state of the session screen: header ("NOT STARTED" eyebrow),
 * the workout's description and meta, and the primary "Start workout"
 * action. Starting the session is the page's own action — no session is
 * created until it is submitted.
 */
export function SessionStartPanel({
  workout,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionStartPanelProps) {
  const exerciseCount = workout.workout.exercises.length;

  return (
    <div className="flex flex-col gap-6">
      <ActiveWorkoutHeader
        workout={workout}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        eyebrow="NOT STARTED"
      />

      <section className="rounded-card border border-border bg-card p-5 md:p-8">
        <p className="max-w-3xl text-sm text-ink-2 md:text-[15px]">
          {workout.workout.description}
        </p>
        <p className="mt-2 text-[13px] text-ink-3 md:text-sm">
          About {workout.workout.estimatedDurationMinutes} minutes · {exerciseCount}{' '}
          {exerciseCount === 1 ? 'exercise' : 'exercises'}
        </p>
        <div className="mt-6">
          <StartSessionButton
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
          />
        </div>
      </section>
      {/* Mobile navigation back to the workout details screen. The locked
          desktop frames use the header's "Workout details" button; the
          tab bar is hidden on session routes, so mobile needs this link. */}
      <Link
        href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
        className="text-[13px] font-medium text-ink-3 underline-offset-4 hover:text-ink hover:underline md:hidden"
      >
        &larr; Workout details
      </Link>
    </div>
  );
}
