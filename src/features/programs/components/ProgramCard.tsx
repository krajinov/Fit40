import Link from 'next/link';

import type { ProgramSummaryDto } from '@/application/dto/program';
import { Badge } from '@/components/shared/Badge';
import { DIFFICULTY_LABELS } from '@/features/exercises/exercise-labels';
import { PROGRAM_GOAL_LABELS } from '@/features/programs/program-labels';

interface ProgramCardProps {
  readonly program: ProgramSummaryDto;
  /** Whether the authenticated user is enrolled in this program. */
  readonly joined?: boolean;
}

/**
 * Catalog card for a training program. The locked design has no dedicated
 * catalog screen; the card uses the locked primitives (card surface, badge
 * pills, Sora heading) so the catalog reads as part of the same system.
 */
export function ProgramCard({ program, joined = false }: ProgramCardProps) {
  return (
    <article className="flex flex-col rounded-card border border-border bg-card p-5 text-card-foreground transition-colors hover:border-ink-3/40">
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge variant="accent">{PROGRAM_GOAL_LABELS[program.goal]}</Badge>
        <Badge>{DIFFICULTY_LABELS[program.difficulty]}</Badge>
        {joined && <Badge variant="done">Joined</Badge>}
      </div>

      <h2 className="mb-2 font-display text-xl font-semibold tracking-tight">
        <Link
          href={`/programs/${program.slug}`}
          className="rounded-control text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {program.name}
        </Link>
      </h2>

      <p className="mb-4 flex-1 text-sm text-ink-2">{program.description}</p>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <span className="block text-xs text-ink-3">Duration</span>
          <span className="font-medium">{program.durationWeeks} weeks</span>
        </div>
        <div>
          <span className="block text-xs text-ink-3">Frequency</span>
          <span className="font-medium">
            {program.workoutsPerWeek} workouts/week
          </span>
        </div>
      </div>
    </article>
  );
}
