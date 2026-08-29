import Link from 'next/link';

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import { EnrollmentPanel } from '@/features/enrollment/components/EnrollmentPanel';
import { DIFFICULTY_LABELS } from '@/features/exercises/exercise-labels';
import {
  PROGRAM_GOAL_LABELS,
} from '@/features/programs/program-labels';

interface ProgramDetailProps {
  readonly program: ProgramDetailDto;
  /**
   * The authenticated user's enrollment view of this program, or null when
   * browsing anonymously (no enrollment controls or progress markers then).
   */
  readonly enrollment: ProgramEnrollmentViewDto | null;
}

function Badge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function WorkoutLink({
  programSlug,
  weekNumber,
  order,
  name,
  done,
}: {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly order: number;
  readonly name: string;
  readonly done: boolean;
}) {
  return (
    <Link
      href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${order}`}
      className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-medium">{name}</span>
      <span className="ml-2 text-xs text-muted-foreground">
        Workout {order}
      </span>
      {done && (
        <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
          Done
        </span>
      )}
    </Link>
  );
}

export function ProgramDetail({ program, enrollment }: ProgramDetailProps) {
  const completedIds =
    enrollment !== null && enrollment.status === 'enrolled'
      ? new Set<string>(enrollment.completedScheduledWorkoutIds)
      : new Set<string>();

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge>{DIFFICULTY_LABELS[program.difficulty]}</Badge>
          <Badge>{PROGRAM_GOAL_LABELS[program.goal]}</Badge>
          <Badge>{program.durationWeeks} weeks</Badge>
          <Badge>{program.workoutsPerWeek} workouts/week</Badge>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {program.name}
        </h1>

        <p className="max-w-3xl text-lg text-muted-foreground">
          {program.description}
        </p>
      </div>

      {enrollment !== null && (
        <EnrollmentPanel programSlug={program.slug} enrollment={enrollment} />
      )}

      <div className="space-y-6">
        <h2 className="text-xl font-semibold tracking-tight">Weekly schedule</h2>

        {program.weeks.map((week) => (
          <section
            key={week.weekNumber}
            className="space-y-3"
            aria-labelledby={`week-${week.weekNumber}-heading`}
          >
            <h3
              id={`week-${week.weekNumber}-heading`}
              className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Week {week.weekNumber}
            </h3>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {week.scheduledWorkouts.map((scheduled) => (
                <WorkoutLink
                  key={scheduled.scheduledWorkoutId}
                  programSlug={program.slug}
                  weekNumber={week.weekNumber}
                  order={scheduled.order}
                  name={scheduled.workoutName}
                  done={completedIds.has(scheduled.scheduledWorkoutId)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
