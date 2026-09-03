import { Badge } from '@/components/shared/Badge';
import type { HistorySessionView } from '@/features/history/history-view';

interface HistorySessionCardProps {
  readonly session: HistorySessionView;
}

/**
 * One completed-workout row of the history list.
 *
 * Sessions render as non-interactive cards until a session-detail route
 * exists: no link, no hover affordance, no pointer cursor — the card never
 * pretends to be clickable. Long names wrap naturally; the view model
 * carries them untruncated.
 */
export function HistorySessionCard({ session }: HistorySessionCardProps) {
  return (
    <li className="rounded-card border border-border bg-card p-5 md:p-6">
      <p className="text-xs font-semibold tracking-wide text-accent-foreground">
        {session.completedAtLabel}
      </p>
      <h3 className="mt-1.5 text-[15px] font-semibold text-foreground">
        {session.workoutName}
      </h3>
      <p className="mt-0.5 text-sm text-ink-2">{session.programName}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{session.setsLabel}</Badge>
        {session.repsLabel !== null && <Badge>{session.repsLabel}</Badge>}
        {session.volumeLabel !== null && <Badge>{session.volumeLabel}</Badge>}
      </div>
    </li>
  );
}
