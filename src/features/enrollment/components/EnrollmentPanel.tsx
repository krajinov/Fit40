import Link from 'next/link';

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import { JoinProgramButton } from '@/features/enrollment/components/JoinProgramButton';
import { LeaveProgramButton } from '@/features/enrollment/components/LeaveProgramButton';

interface EnrollmentPanelProps {
  readonly programSlug: string;
  readonly enrollment: ProgramEnrollmentViewDto;
}

/**
 * Enrollment controls and derived progress for the program detail page.
 *
 * Rendered only for authenticated users; anonymous visitors keep the public
 * read-only catalog view. All displayed progress is computed per enrollment
 * by the application layer — nothing derived is persisted.
 */
export function EnrollmentPanel({ programSlug, enrollment }: EnrollmentPanelProps) {
  if (enrollment.status === 'not-enrolled') {
    return (
      <section aria-label="Join this program" className="rounded-xl border border-border bg-card p-5">
        <JoinProgramButton programSlug={programSlug} />
      </section>
    );
  }

  const { progress, nextWorkout } = enrollment;

  return (
    <section
      aria-label="Your enrollment"
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            Progress: {progress.percentage}%
          </p>
          <p className="text-sm text-muted-foreground">
            {progress.completedWorkouts} of {progress.totalWorkouts} workouts completed
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {/* Dynamic width requires an inline style; utility classes cannot express it. */}
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {nextWorkout === null ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Program completed
          </span>
        ) : (
          <Link
            href={`/programs/${programSlug}/weeks/${nextWorkout.weekNumber}/workouts/${nextWorkout.workoutOrder}/session`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Start next workout
          </Link>
        )}
        <LeaveProgramButton programSlug={programSlug} />
      </div>
    </section>
  );
}
