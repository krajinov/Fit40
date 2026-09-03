import { Check, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';

import type { ExerciseDetailDto } from '@/application/dto/exercise';
import type { SuitabilityLevel } from '@/domain/types/exercise';
import { SuitabilityLevel as SuitabilityLevelType } from '@/domain/types/exercise';
import { Badge } from '@/components/shared/Badge';
import { SectionCard } from '@/components/shared/SectionCard';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_LABELS,
  PHYSICAL_CONSIDERATION_LABELS,
  SUITABILITY_LABELS,
} from '@/features/exercises/exercise-labels';

interface ExerciseDetailProps {
  readonly exercise: ExerciseDetailDto;
}

type ExerciseConsideration = ExerciseDetailDto['considerations'][number];

/** Status icon per suitability level; the level is always also shown as text. */
const SUITABILITY_ICONS: Record<SuitabilityLevel, LucideIcon> = {
  [SuitabilityLevelType.Suitable]: Check,
  [SuitabilityLevelType.Caution]: TriangleAlert,
  [SuitabilityLevelType.Unsuitable]: CircleX,
};

function ConsiderationRow({
  consideration,
}: {
  readonly consideration: ExerciseConsideration;
}) {
  const Icon = SUITABILITY_ICONS[consideration.level];

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Badge>
        <Icon aria-hidden="true" className="size-3.5" />
        {SUITABILITY_LABELS[consideration.level]}
      </Badge>
      <span className="text-sm text-ink-2">
        {PHYSICAL_CONSIDERATION_LABELS[consideration.consideration]}
      </span>
    </li>
  );
}

export function ExerciseDetail({ exercise }: ExerciseDetailProps) {
  const hasSecondaryMuscles = exercise.secondaryMuscles.length > 0;
  const hasConsiderations = exercise.considerations.length > 0;

  return (
    <article className="space-y-6 md:space-y-8">
      <header className="space-y-3">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {exercise.name}
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          {exercise.description}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <SectionCard title="Muscles worked">
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-3">Primary</dt>
              <dd className="font-medium text-foreground">
                {MUSCLE_GROUP_LABELS[exercise.primaryMuscle]}
              </dd>
            </div>
          </dl>
          {hasSecondaryMuscles && (
            <div className="mt-5 border-t border-border pt-5">
              <p className="text-xs font-semibold tracking-wide text-ink-3">
                Also works
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {exercise.secondaryMuscles.map((muscle) => (
                  <li key={muscle}>
                    <Badge>{MUSCLE_GROUP_LABELS[muscle]}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard title="At a glance">
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-3">Equipment</dt>
              <dd className="font-medium text-foreground">
                {EQUIPMENT_LABELS[exercise.equipment]}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-3">Difficulty</dt>
              <dd className="font-medium text-foreground">
                {DIFFICULTY_LABELS[exercise.difficulty]}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-3">Movement pattern</dt>
              <dd className="text-right font-medium text-foreground">
                {MOVEMENT_PATTERN_LABELS[exercise.movementPattern]}
              </dd>
            </div>
          </dl>
        </SectionCard>
      </div>

      {hasConsiderations && (
        <SectionCard title="Training guidance">
          <p className="mb-5 text-sm text-ink-2">
            This guidance is for program planning only and is not medical advice.
          </p>
          <ul className="space-y-3">
            {exercise.considerations.map((consideration) => (
              <ConsiderationRow
                key={consideration.consideration}
                consideration={consideration}
              />
            ))}
          </ul>
        </SectionCard>
      )}
    </article>
  );
}