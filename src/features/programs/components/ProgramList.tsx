import type { ProgramSummaryDto } from '@/application/dto/program';
import { ProgramCard } from '@/features/programs/components/ProgramCard';

interface ProgramListProps {
  readonly programs: ReadonlyArray<ProgramSummaryDto>;
}

export function ProgramList({ programs }: ProgramListProps) {
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
        />
      ))}
    </div>
  );
}