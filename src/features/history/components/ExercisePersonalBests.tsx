import Link from 'next/link';

import { Stat } from '@/components/shared/Stat';
import type { PersonalBestView } from '@/features/history/personal-best-view';

interface ExercisePersonalBestsProps {
  readonly personalBests: ReadonlyArray<PersonalBestView>;
}

/**
 * Current all-time personal bests of one exercise (M12).
 *
 * Locked presentation decisions:
 * - Only the metrics that actually exist render: an exercise with a single
 *   applicable metric shows a single tile, and no placeholder is fabricated
 *   for a metric the user never qualified for (a weighted barbell movement has
 *   no bodyweight-reps record, a bodyweight movement may have no load record).
 * - Each tile names what the record measures, shows the value in its own unit,
 *   and links to the completed session that OWNS the record — the repository's
 *   winner, never a later session that merely repeated the value.
 * - The link's visible text is meaningful on its own ("Achieved Feb 15, 2026"),
 *   so nothing depends on hover and keyboard users get the same information.
 * - The value is read-only context: these records never feed a target,
 *   recommendation, or progression state.
 */
export function ExercisePersonalBests({ personalBests }: ExercisePersonalBestsProps) {
  if (personalBests.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        No personal bests yet. They are recorded from your completed performances of this
        exercise.
      </p>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {personalBests.map((best) => (
        <li key={best.key} className="rounded-card border border-border bg-surface-2 p-5">
          <Stat value={best.valueLabel} label={best.metricLabel} />
          <p className="mt-3 text-sm">
            <Link
              href={best.sessionHref}
              className="rounded-control text-ink-2 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Achieved {best.completedAtLabel}
            </Link>
          </p>
        </li>
      ))}
    </ul>
  );
}
