import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import { JoinProgramButton } from '@/features/enrollment/components/JoinProgramButton';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import Link from 'next/link';

interface SessionJoinPanelProps {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Not-enrolled state of the session screen: header plus the join prompt —
 * joining the program is a precondition for creating any session. The
 * enrollment CONTRACT (ownership, revalidation) lives in the enrollment
 * feature and is untouched by this redesign.
 */
export function SessionJoinPanel({
  workout,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionJoinPanelProps) {
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
          Join {workout.programName} to start and track this workout.
        </p>
        <div className="mt-6">
          <JoinProgramButton programSlug={programSlug} />
        </div>
      </section>
      {/* Mobile navigation back to the workout details screen; the tab bar
          is hidden on session routes. */}
      <Link
        href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
        className="text-[13px] font-medium text-ink-3 underline-offset-4 hover:text-ink hover:underline md:hidden"
      >
        &larr; Workout details
      </Link>
    </div>
  );
}
