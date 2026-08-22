import Link from 'next/link';

import type { ProgramSummaryDto } from '@/application/dto/program';
import { DIFFICULTY_LABELS } from '@/features/exercises/exercise-labels';
import {
  formatDuration,
  PROGRAM_GOAL_LABELS,
} from '@/features/programs/program-labels';

interface ProgramCardProps {
  readonly program: ProgramSummaryDto;
}

function Badge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function ProgramCard({ program }: ProgramCardProps) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-muted-foreground/25">
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge>{DIFFICULTY_LABELS[program.difficulty]}</Badge>
        <Badge>{PROGRAM_GOAL_LABELS[program.goal]}</Badge>
      </div>

      <h2 className="mb-2 text-xl font-semibold tracking-tight">
        <Link
          href={`/programs/${program.slug}`}
          className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {program.name}
        </Link>
      </h2>

      <p className="mb-4 flex-1 text-sm text-muted-foreground">{program.description}</p>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <span className="block text-xs text-muted-foreground">Duration</span>
          <span className="font-medium">{program.durationWeeks} weeks</span>
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Frequency</span>
          <span className="font-medium">
            {program.workoutsPerWeek} workouts/week
          </span>
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Time</span>
          <span className="font-medium">{formatDuration(45)}</span>
        </div>
      </div>
    </article>
  );
}