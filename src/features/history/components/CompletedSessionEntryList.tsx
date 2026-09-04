import Link from 'next/link';

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
 * when an exercise can no longer be resolved.
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
          className="rounded-card border border-border bg-card p-5 md:p-6"
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
          {entry.equipmentLabel !== null && (
            <p className="mt-0.5 text-sm text-ink-2">{entry.equipmentLabel}</p>
          )}
          {entry.sets.length > 0 ? (
            <ol className="mt-3 flex flex-col divide-y divide-border">
              {entry.sets.map((set) => (
                <li key={set.setNumber} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="w-6 shrink-0 text-ink-3 tabular-nums">{set.setNumber}</span>
                  <span className="font-medium text-foreground">{set.valueLabel}</span>
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
