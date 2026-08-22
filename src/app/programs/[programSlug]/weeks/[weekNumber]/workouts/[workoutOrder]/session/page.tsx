import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import { getWorkoutSessionUseCase } from '@/features/sessions/services';
import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/programs/schemas/program-routes-schema';
import { startSessionAction } from '@/features/sessions/actions/start-session';
import { completeSessionAction } from '@/features/sessions/actions/complete-session';
import { SetLoggerForm } from '@/features/sessions/components/SetLoggerForm';
import { LoggedSetRow } from '@/features/sessions/components/LoggedSetRow';
import { formatPrescription } from '@/features/programs/program-labels';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';

interface Props {
  readonly params: Promise<{
    readonly programSlug: string;
    readonly weekNumber: string;
    readonly workoutOrder: string;
  }>;
}

const getWorkout = cache(async (programSlug: string, weekNumber: number, workoutOrder: number) => {
  return getScheduledWorkoutUseCase.execute({ programSlug, weekNumber, workoutOrder });
});

const getSession = cache(async (programSlug: string, weekNumber: number, workoutOrder: number) => {
  return getWorkoutSessionUseCase.execute({ programSlug, weekNumber, workoutOrder });
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { programSlug, weekNumber, workoutOrder } = await params;
  const weekResult = weekNumberSchema.safeParse(weekNumber);
  const orderResult = workoutOrderSchema.safeParse(workoutOrder);
  if (!weekResult.success || !orderResult.success) return { title: 'Session not found' };
  const result = await getWorkout(programSlug, weekResult.data, orderResult.data);
  if (!result.ok) return { title: 'Session not found' };
  return { title: `${result.data.workout.name} - Session` };
}

function StartPanel({
  workout,
  programSlug,
  weekNumber,
  workoutOrder,
}: {
  readonly workout: ScheduledWorkoutDetailDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{workout.workout.name}</h1>
        <p className="text-lg text-muted-foreground">{workout.workout.description}</p>
        <p className="text-sm text-muted-foreground">
          {workout.workout.estimatedDurationMinutes} min &middot;{' '}
          {workout.workout.exercises.length} exercises
        </p>
      </div>
      <form action={startSessionAction}>
        <input type="hidden" name="programSlug" value={programSlug} />
        <input type="hidden" name="weekNumber" value={weekNumber} />
        <input type="hidden" name="workoutOrder" value={workoutOrder} />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Start workout
        </button>
      </form>
      <div>
        <Link
          href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          &larr; Back to workout details
        </Link>
      </div>
    </div>
  );
}

function InProgressPanel({
  session,
  programSlug,
  weekNumber,
  workoutOrder,
}: {
  readonly session: WorkoutSessionDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Workout in progress</h1>
        <p className="text-sm text-muted-foreground">
          Started at {new Date(session.startedAt).toLocaleTimeString()}
        </p>
      </div>

      <ol className="divide-y divide-border rounded-xl border border-border">
        {session.exerciseLogs.map((log) => (
          <li key={log.order} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {log.order}
              </span>
              <span className="font-medium">Exercise {log.order}</span>
            </div>
            <p className="pl-9 text-sm text-muted-foreground">
              Prescription: {formatPrescription(log.prescription)}
            </p>

            {log.sets.length > 0 && (
              <ul className="pl-9 space-y-1">
                {log.sets.map((set) => (
                  <LoggedSetRow
                    key={set.setNumber}
                    sessionId={session.sessionId}
                    set={set}
                    exerciseOrder={log.order}
                    programSlug={programSlug}
                    weekNumber={weekNumber}
                    workoutOrder={workoutOrder}
                    isReps={log.prescription.type === 'reps'}
                  />
                ))}
              </ul>
            )}

            <SetLoggerForm
              sessionId={session.sessionId}
              exerciseOrder={log.order}
              prescription={log.prescription}
              programSlug={programSlug}
              weekNumber={weekNumber}
              workoutOrder={workoutOrder}
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <form action={completeSessionAction}>
          <input type="hidden" name="sessionId" value={session.sessionId} />
          <input type="hidden" name="programSlug" value={programSlug} />
          <input type="hidden" name="weekNumber" value={weekNumber} />
          <input type="hidden" name="workoutOrder" value={workoutOrder} />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Complete workout
          </button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">
        Session metrics: {session.metrics.totalSets} sets, {session.metrics.totalReps} reps,{' '}
        {session.metrics.totalDurationSeconds}s duration, {session.metrics.volume} kg volume
      </p>
    </div>
  );
}

function CompletedPanel({
  session,
  programSlug,
  weekNumber,
  workoutOrder,
}: {
  readonly session: WorkoutSessionDto;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Workout complete</h1>
        <p className="text-sm text-muted-foreground">
          Started {new Date(session.startedAt).toLocaleTimeString()}
          {session.completedAt
            ? `, completed ${new Date(session.completedAt).toLocaleTimeString()}`
            : ''}
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
            {session.metrics.totalSets} sets
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
            {session.metrics.totalReps} reps
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
            {session.metrics.totalDurationSeconds}s duration
          </span>
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
            {session.metrics.volume} kg volume
          </span>
        </div>
      </div>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {session.exerciseLogs.map((log) => (
          <li key={log.order} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                {log.order}
              </span>
              <span className="font-medium">Exercise {log.order}</span>
              {log.sets.length === 0 && (
                <span className="text-xs text-muted-foreground">(skipped)</span>
              )}
            </div>
            <p className="pl-9 text-sm text-muted-foreground">
              Prescription: {formatPrescription(log.prescription)}
            </p>
            {log.sets.length > 0 && (
              <ul className="pl-9 space-y-1">
                {log.sets.map((set) => (
                  <li key={set.setNumber} className="text-sm">
                    Set {set.setNumber}:{' '}
                    {set.type === 'reps'
                      ? `${set.reps} reps${set.weightKg !== null ? ` x ${set.weightKg} kg` : ''}${set.rpe !== null ? ` @ RPE ${set.rpe}` : ''}`
                      : `${set.durationSeconds}s${set.weightKg !== null ? ` x ${set.weightKg} kg` : ''}${set.rpe !== null ? ` @ RPE ${set.rpe}` : ''}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <div>
        <Link
          href={`/programs/${programSlug}/weeks/${weekNumber}/workouts/${workoutOrder}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          &larr; Back to workout details
        </Link>
      </div>
    </div>
  );
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

  const workoutResult = await getWorkout(ps, wn, wo);
  if (!workoutResult.ok) notFound();

  const sessionResult = await getSession(ps, wn, wo);
  if (!sessionResult.ok) notFound();

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      {sessionResult.data === null ? (
        <StartPanel workout={workoutResult.data} programSlug={ps} weekNumber={wn} workoutOrder={wo} />
      ) : sessionResult.data.status === 'completed' ? (
        <CompletedPanel session={sessionResult.data} programSlug={ps} weekNumber={wn} workoutOrder={wo} />
      ) : (
        <InProgressPanel
          session={sessionResult.data}
          programSlug={ps}
          weekNumber={wn}
          workoutOrder={wo}
        />
      )}
    </main>
  );
}