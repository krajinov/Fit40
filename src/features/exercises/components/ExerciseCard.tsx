import Link from 'next/link';

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { Badge } from '@/components/shared/Badge';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
} from '@/features/exercises/exercise-labels';

interface ExerciseCardProps {
  readonly exercise: ExerciseSummaryDto;
}

/**
 * Catalog card for an exercise. Mirrors the ProgramCard locked layout
 * (badge row, Sora heading link, stat footer) so both catalogs read as
 * part of the same system.
 */
export function ExerciseCard({ exercise }: ExerciseCardProps) {
  return (
    <article className="flex h-full flex-col rounded-card border border-border bg-card p-5 text-card-foreground transition-colors hover:border-ink-3/40">
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge variant="accent">{MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}</Badge>
        <Badge>{DIFFICULTY_LABELS[exercise.difficulty]}</Badge>
      </div>

      <h2 className="mb-2 font-display text-xl font-semibold tracking-tight">
        <Link
          href={`/exercises/${exercise.slug}`}
          className="rounded-control text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {exercise.name}
        </Link>
      </h2>

      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <span className="block text-xs text-ink-3">Equipment</span>
          <span className="font-medium">{EQUIPMENT_LABELS[exercise.equipment]}</span>
        </div>
        <div>
          <span className="block text-xs text-ink-3">Movement</span>
          <span className="font-medium">
            {MOVEMENT_PATTERN_LABELS[exercise.movementPattern]}
          </span>
        </div>
      </div>
    </article>
  );
}