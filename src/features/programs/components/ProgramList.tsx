import type { ProgramSummaryDto } from '@/application/dto/program';
import { ProgramCard } from '@/features/programs/components/ProgramCard';

interface ProgramListProps {
  readonly programs: ReadonlyArray<ProgramSummaryDto>;
  /**
   * Program ids the authenticated user is enrolled in. Empty (or omitted)
   * for anonymous visitors, who see the plain public catalog.
   */
  readonly enrolledProgramIds?: ReadonlySet<string>;
}

export function ProgramList({ programs, enrolledProgramIds }: ProgramListProps) {
  if (programs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">No programs available.</p>
      </div>
    );
  }

  return (
    <div
      className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      role="list"
    >
      {programs.map((program) => (
        <ProgramCard
          key={program.id}
          program={program}
          joined={enrolledProgramIds?.has(program.id) ?? false}
        />
      ))}
    </div>
  );
}