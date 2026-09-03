import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import type { HistorySessionView } from '@/features/history/history-view';

interface HistorySessionCardProps {
  readonly session: HistorySessionView;
}

/**
 * One completed-workout row of the history list: a block link to the
 * session-detail page. The whole card is the anchor (one large touch
 * target); long names wrap naturally — the view model carries them
 * untruncated.
 */
export function HistorySessionCard({ session }: HistorySessionCardProps) {
  return (
    <li className="rounded-card border border-border bg-card">
      <Link
        href={`/history/sessions/${session.sessionId}`}
        className="group block rounded-card p-5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:p-6"
      >
        <p className="text-xs font-semibold tracking-wide text-accent-foreground">
          {session.completedAtLabel}
        </p>
        <h3 className="mt-1.5 text-[15px] font-semibold text-foreground group-hover:underline">
          {session.workoutName}
        </h3>
        <p className="mt-0.5 text-sm text-ink-2">{session.programName}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{session.setsLabel}</Badge>
          {session.repsLabel !== null && <Badge>{session.repsLabel}</Badge>}
          {session.volumeLabel !== null && <Badge>{session.volumeLabel}</Badge>}
        </div>
      </Link>
    </li>
  );
}
