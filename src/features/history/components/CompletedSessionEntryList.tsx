import Link from 'next/link';

import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { CompletedSessionEntryView } from '@/features/history/completed-session-view';

interface CompletedSessionEntryListProps {
  readonly entries: ReadonlyArray<CompletedSessionEntryView>;
}

/**
 * The workout's exercise entries in persisted order.
 *
 * Rows are keyed by `exerciseOrder`, which is unique within a session — the
 * (sessionId, exerciseOrder) identity — so two entries of the same exercise
 * (e.g. a finisher repeat) render as separate cards and never collapse.
 * Historical truth: set lines render the persisted snapshot; current catalog
 * data only supplies the name/equipment labels, with positional fallbacks
 * when an exercise can no longer be resolved. The PERFORMED exercise is the
 * primary identity; a substituted occurrence carries the read-only
 * "Originally: …" authored-exercise context line (history has no
 * substitution controls).
 *
 * Skipped occurrences (M10) stay visible in persisted order as de-emphasized
 * cards: the neutral "Skipped" badge replaces any set output, no
 * performance-history link renders (the view model resolves none), and the
 * persisted skip decision is authoritative — zero logged sets never implies
 * skipped. Completed history exposes no mutation controls.
 *
 * Historical personal records (M12 Slice 4) render as a restrained "PR" badge
 * on the exact set row that established the record — the view model has
 * already decided which rows those are, so this component only displays the
 * state it is handed. A skipped occurrence renders no set rows and therefore
 * can never show one.
 */
export function CompletedSessionEntryList({ entries }: CompletedSessionEntryListProps) {
  if (entries.length === 0) {
    return (
      <p className="mt-6 text-sm text-ink-2">No exercises were recorded for this workout.</p>
    );
  }

  return (
    <ol aria-label="Exercises" className="mt-6 flex flex-col gap-4 md:mt-8">
      {entries.map((entry) => (
        <li
          key={entry.exerciseOrder}
          className={cn(
            'rounded-card border border-border bg-card p-5 md:p-6',
            entry.isSkipped && 'opacity-80',
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {entry.historyHref !== null ? (
              <Link
                href={entry.historyHref}
                className="rounded-control text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {entry.name}
              </Link>
            ) : (
              <h2 className="text-[15px] font-semibold text-foreground">{entry.name}</h2>
            )}
            <p className="text-sm text-ink-3">{entry.prescriptionLabel}</p>
          </div>
          {entry.provenanceLabel !== null && (
            <p className="mt-0.5 text-xs text-ink-3">{entry.provenanceLabel}</p>
          )}
          {entry.originallyName !== null && (
            <p className="mt-0.5 text-xs text-ink-3">Originally: {entry.originallyName}</p>
          )}
          {entry.equipmentLabel !== null && (
            <p className="mt-0.5 text-sm text-ink-2">{entry.equipmentLabel}</p>
          )}
          {entry.isSkipped ? (
            <div className="mt-3">
              <Badge variant="neutral">Skipped</Badge>
            </div>
          ) : entry.sets.length > 0 ? (
            <ol className="mt-3 flex flex-col divide-y divide-border">
              {entry.sets.map((set) => (
                <li key={set.setNumber} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="w-6 shrink-0 text-ink-3 tabular-nums">{set.setNumber}</span>
                  <span className="font-medium text-foreground">{set.valueLabel}</span>
                  {set.isPersonalRecord && (
                    // Historical record metadata (M12 Slice 4): the state is
                    // resolved upstream for exactly this set. The abbreviation
                    // stays compact visually while screen readers get the full
                    // phrase — no hover-only meaning.
                    <Badge variant="accent">
                      <span aria-hidden="true">PR</span>
                      <span className="sr-only">Personal record</span>
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-ink-3">No sets were logged.</p>
          )}
          {entry.restLabel !== null && (
            <p className="mt-2 text-xs text-ink-3">{entry.restLabel}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
