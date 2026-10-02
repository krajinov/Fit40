import Link from 'next/link';

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import { ActiveWorkoutHeader } from '@/features/sessions/components/ActiveWorkoutHeader';
import { WorkoutStartPanel } from '@/features/sessions/components/WorkoutStartPanel';

interface SessionRecordedPanelProps {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Settled state of the session screen (M17 final review): the occurrence was
 * recorded as not performed, so a direct/bookmarked session URL states that
 * fact and exposes the existing Undo affordance instead of an impossible
 * "Start workout". It reuses the workout detail CTA band's recorded branch so
 * the copy and control are identical across surfaces, and offers no Start.
 */
export function SessionRecordedPanel({
  workout,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionRecordedPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <ActiveWorkoutHeader
        workout={workout}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        eyebrow="RECORDED AS NOT PERFORMED"
      />

      {/* The recorded branch of the shared CTA band: heading "Recorded as not
          performed", the "It goes back to not started." supporting copy and the
          Undo form — never a Start. */}
      <WorkoutStartPanel
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        ctaState="not-performed"
      />

      {/* Mobile navigation back to the workout details screen (mirrors
          SessionStartPanel; the header's button is desktop-only). */}
      <Link
        href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
        className="text-[13px] font-medium text-ink-3 underline-offset-4 hover:text-ink hover:underline md:hidden"
      >
        &larr; Workout details
      </Link>
    </div>
  );
}
