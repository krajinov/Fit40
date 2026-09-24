import Link from 'next/link';

import type { HistoryExerciseShortcutView } from '@/features/history/history-view';

interface HistoryExerciseShortcutsProps {
  readonly shortcuts: ReadonlyArray<HistoryExerciseShortcutView>;
}

/**
 * "Recently trained exercises" — direct links into the performance history of
 * exercises performed in the loaded page, most recently trained first.
 *
 * Which exercises exist, what they are called and where they link is decided
 * upstream by the view model (one batched catalog lookup); this component only
 * displays what it is handed. Nothing is rendered when the list is empty: an
 * empty shelf is never shown, and the section simply does not exist.
 *
 * Each pill is a 44px-tall touch target (`h-11`) — the docs/ui.md floor — with
 * the compact pill styling (radius, border, padding, type) otherwise intact.
 */
export function HistoryExerciseShortcuts({ shortcuts }: HistoryExerciseShortcutsProps) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="history-shortcuts-heading" className="flex flex-col gap-3">
      <h2
        id="history-shortcuts-heading"
        className="text-xs font-semibold tracking-wide text-accent-foreground md:text-[13px]"
      >
        Recently trained exercises
      </h2>
      <ul className="flex flex-wrap gap-2">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.exerciseId}>
            <Link
              href={shortcut.href}
              className="inline-flex h-11 items-center rounded-pill border border-border bg-card px-3.5 text-sm font-medium text-ink-2 outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {shortcut.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}