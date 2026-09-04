import Link from 'next/link';

import type { ExerciseHistoryEntryView } from '@/features/history/exercise-history-view';

interface ExerciseHistoryOccurrenceListProps {
  readonly entries: ReadonlyArray<ExerciseHistoryEntryView>;
}

/**
 * The exercise's historical occurrences, newest first, as persisted.
 *
 * Rows are keyed by `${sessionId}#${exerciseOrder}` — the occurrence
 * identity — so the same exercise performed twice in one session renders
 * as two entries and never collapses. Set lines render the persisted
 * snapshot (0 kg is a real load; null weight is bodyweight; RPE only when
 * captured). The working load is the occurrence's minimum external load.
 * The workout name links to the owning session's detail page.
 */
export function ExerciseHistoryOccurrenceList({
  entries,
}: ExerciseHistoryOccurrenceListProps) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="rounded-card border border-border bg-card p-5 md:p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Link
              href={entry.sessionHref}
              className="text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {entry.workoutName}
            </Link>
            <p className="text-sm text-ink-3">{entry.completedAtLabel}</p>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            {entry.programName} · {entry.prescriptionLabel}
          </p>

          <ol className="mt-3 flex flex-col divide-y divide-border">
            {entry.setLines.map((line, index) => (
              <li key={index} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="w-6 shrink-0 text-ink-3 tabular-nums">{index + 1}</span>
                <span className="font-medium text-foreground">{line}</span>
              </li>
            ))}
          </ol>

          {entry.workingLoadLabel !== null && (
            <p className="mt-2 text-sm text-ink-2">{entry.workingLoadLabel}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
