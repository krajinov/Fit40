import Link from 'next/link';
import { ListChecks } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';

interface NoProgramCardProps {
  readonly className?: string;
}

/**
 * Empty state for users not enrolled in any program (no Pencil mockup
 * exists for this state): points at the public program catalog.
 */
export function NoProgramCard({ className }: NoProgramCardProps) {
  return (
    <div className={className}>
      <EmptyState
        icon={<ListChecks className="size-6" />}
        title="No program yet"
        body="Join a training program to see your next workout, weekly progress and recent training here."
      />
      <div className="mt-4 flex justify-center">
        <Link href="/programs" className={buttonVariants()}>
          Browse programs
        </Link>
      </div>
    </div>
  );
}
