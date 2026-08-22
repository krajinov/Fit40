import Link from 'next/link';

import type { ExerciseDetailDto } from '@/application/dto/exercise';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
} from '@/features/exercises/exercise-labels';

interface ExerciseDetailProps {
  readonly exercise: ExerciseDetailDto;
}

function Badge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function ConsiderationLabel({
  consideration,
}: {
  readonly consideration: ExerciseDetailDto['considerations'][number];
}) {
  const levelText =
    consideration.level === 'caution'
      ? 'Use caution'
      : 'May be unsuitable';

  return (
    <li className="text-sm text-muted-foreground">
      {levelText} if {consideration.consideration.replace(/-/g, ' ')}
    </li>
  );
}

export function ExerciseDetail({ exercise }: ExerciseDetailProps) {
  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <Link
          href="/exercises"
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          ← Back to catalog
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {exercise.name}
        </h1>
      </div>

      <p className="text-lg text-muted-foreground">{exercise.description}</p>

      <div className="flex flex-wrap gap-2">
        <Badge>{MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}</Badge>
        {exercise.secondaryMuscles.length > 0 && (
          <Badge>
            Also:{' '}
            {exercise.secondaryMuscles
              .map((muscle) => MUSCLE_GROUP_LABELS[muscle])
              .join(', ')}
          </Badge>
        )}
        <Badge>{EQUIPMENT_LABELS[exercise.equipment]}</Badge>
        <Badge>{DIFFICULTY_LABELS[exercise.difficulty]}</Badge>
        <Badge>{MOVEMENT_PATTERN_LABELS[exercise.movementPattern]}</Badge>
      </div>

      {exercise.considerations.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/50 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground">
            Training guidance
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            This guidance is for program planning only and is not medical advice.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {exercise.considerations.map((consideration) => (
              <ConsiderationLabel
                key={consideration.consideration}
                consideration={consideration}
              />
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}