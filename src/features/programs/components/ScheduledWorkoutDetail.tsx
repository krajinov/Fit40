import Link from 'next/link';

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import {
  formatDuration,
  formatPrescription,
} from '@/features/programs/program-labels';

interface ScheduledWorkoutDetailProps {
  readonly workout: ScheduledWorkoutDetailDto;
}

function Badge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function ScheduledWorkoutDetail({ workout }: ScheduledWorkoutDetailProps) {
  return (
    <article className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link
            href={`/programs/${workout.programSlug}`}
            className="hover:text-foreground hover:underline"
          >
            {workout.programName}
          </Link>
          <span aria-hidden="true">/</span>
          <span>Week {workout.weekNumber}</span>
          <span aria-hidden="true">/</span>
          <span>Workout {workout.order}</span>
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {workout.workout.name}
        </h1>

        <p className="max-w-3xl text-lg text-muted-foreground">
          {workout.workout.description}
        </p>

        <Badge>{formatDuration(workout.workout.estimatedDurationMinutes)}</Badge>
      </div>

      <section aria-labelledby="exercises-heading">
        <h2
          id="exercises-heading"
          className="mb-4 text-xl font-semibold tracking-tight"
        >
          Exercises
        </h2>

        <ol className="divide-y divide-border rounded-xl border border-border">
          {workout.workout.exercises.map((exercise) => (
            <li
              key={exercise.order}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {exercise.order}
                  </span>
                  <Link
                    href={`/exercises/${exercise.exerciseSlug}`}
                    className="font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {exercise.exerciseName}
                  </Link>
                </div>
                {exercise.notes && (
                  <p className="pl-9 text-sm text-muted-foreground">{exercise.notes}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3 pl-9 text-sm sm:pl-0">
                <Badge>{formatPrescription(exercise.prescription)}</Badge>
                <Badge>{exercise.restSeconds}s rest</Badge>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/programs/${workout.programSlug}/weeks/${workout.weekNumber}/workouts/${workout.order}/session`}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Workout session
        </Link>

        <Link
          href={`/programs/${workout.programSlug}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to {workout.programName}
        </Link>
      </div>
    </article>
  );
}