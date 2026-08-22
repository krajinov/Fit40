import Link from 'next/link';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
} from '@/features/exercises/exercise-labels';

interface ExerciseCardProps {
  readonly exercise: ExerciseSummaryDto;
}

function Badge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function ExerciseCard({ exercise }: ExerciseCardProps) {
  return (
    <Link
      href={`/exercises/${exercise.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <h2 className="text-lg font-semibold text-card-foreground group-hover:text-foreground">
        {exercise.name}
      </h2>
      <div className="mt-auto flex flex-wrap gap-2">
        <Badge>{MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}</Badge>
        <Badge>{EQUIPMENT_LABELS[exercise.equipment]}</Badge>
        <Badge>{DIFFICULTY_LABELS[exercise.difficulty]}</Badge>
        <Badge>{MOVEMENT_PATTERN_LABELS[exercise.movementPattern]}</Badge>
      </div>
    </Link>
  );
}