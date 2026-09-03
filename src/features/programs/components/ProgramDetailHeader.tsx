import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import { DIFFICULTY_LABELS } from '@/features/exercises/exercise-labels';
import { PROGRAM_GOAL_LABELS } from '@/features/programs/program-labels';
import type { ProgramDetailDto } from '@/application/dto/program';

interface ProgramDetailHeaderProps {
  readonly program: ProgramDetailDto;
}

/**
 * Program detail header (locked design): breadcrumb, badges (goal accent,
 * difficulty/duration/frequency neutral), Sora title and description.
 *
 * The cadence suffix shown next to "Weekly schedule" in the locked design
 * ("Mon · Wed · Fri") is omitted: programs schedule workouts per program
 * week, not per weekday, so no truthful weekday cadence exists.
 */
export function ProgramDetailHeader({ program }: ProgramDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <Link
          href="/programs"
          className="text-[13px] font-medium text-accent-foreground underline-offset-4 hover:underline md:text-sm"
        >
          Programs
        </Link>
        <span aria-hidden="true" className="text-[13px] text-ink-3 md:text-sm">
          /
        </span>
        <span aria-current="page" className="text-[13px] text-ink-3 md:text-sm">
          {program.name}
        </span>
      </nav>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="accent">{PROGRAM_GOAL_LABELS[program.goal]}</Badge>
          <Badge>{DIFFICULTY_LABELS[program.difficulty]}</Badge>
          <Badge>{program.durationWeeks} weeks</Badge>
          <Badge>
            {program.workoutsPerWeek} workouts / week
          </Badge>
        </div>

        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {program.name}
        </h1>

        <p className="max-w-3xl text-sm text-ink-2 md:max-w-[760px] md:text-[17px]">
          {program.description}
        </p>
      </div>
    </div>
  );
}
