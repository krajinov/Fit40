/**
 * Server-side view mapping for the per-exercise Personal Bests summary (M12).
 *
 * Presentation owns formatting: the DTO carries the metric, the raw value and
 * the owning position, and this module turns those into display labels and the
 * `/history/sessions/[sessionId]` link. Nothing is recomputed, re-ranked or
 * re-selected here — the exact records the repository returned are mapped in
 * the order delivered (deterministic: exercise id, then metric), so a later
 * performance that merely repeated a maximum can never take over the link.
 *
 * Formatting reuses the shared conventions: `formatKg` trims float dust while
 * keeping half-kilos (a logged 0 kg stays a real load), `formatSeconds` renders
 * timed work as "45 sec", reps values render as plain integers, and dates use
 * the history screen's UTC date format.
 */

import type { PersonalBestDto, PersonalRecordMetricDto } from '@/application/dto/personal-records';
import { formatHistoryDate } from '@/features/history/history-labels';
import { formatKg, formatSeconds } from '@/features/sessions/progression-labels';

export interface PersonalBestView {
  /** One record per metric per exercise, so the metric is the row's identity. */
  readonly key: string;
  /** The label naming what the record measures, e.g. "Heaviest load". */
  readonly metricLabel: string;
  /** The value in its metric's unit, e.g. "82.5 kg" / "18 reps" / "75 sec". */
  readonly valueLabel: string;
  readonly completedAtLabel: string;
  /** The completed session that OWNS the record. */
  readonly sessionHref: string;
}

/** Metric → the label naming what the record measures (total by type). */
const METRIC_LABELS: Record<PersonalRecordMetricDto, string> = {
  'max-load': 'Heaviest load',
  'max-bodyweight-reps': 'Most bodyweight reps',
  'max-duration': 'Longest duration',
};

/**
 * The record value in its metric's own unit. Loads keep meaningful decimals
 * (0 kg renders as "0 kg"); reps are integers; durations follow the timed-work
 * convention already used for logged sets ("75 sec").
 */
export function personalBestValueLabel(best: PersonalBestDto): string {
  switch (best.metric) {
    case 'max-load':
      return formatKg(best.value);
    case 'max-bodyweight-reps':
      return `${Math.round(best.value)} reps`;
    case 'max-duration':
      return formatSeconds(best.value);
  }
}

/** Pure DTO → view mapping for one record. */
export function toPersonalBestView(best: PersonalBestDto): PersonalBestView {
  return {
    key: best.metric,
    metricLabel: METRIC_LABELS[best.metric],
    valueLabel: personalBestValueLabel(best),
    completedAtLabel: formatHistoryDate(best.completedAt),
    sessionHref: `/history/sessions/${best.sessionId}`,
  };
}

/**
 * Maps the exercise's records for the summary. Only the metrics the repository
 * actually returned appear — an exercise with a single applicable metric
 * renders a single tile, and no empty placeholder is fabricated. An empty list
 * is a valid result (the screen renders its neutral note).
 */
export function toPersonalBestsView(
  bests: ReadonlyArray<PersonalBestDto>,
): ReadonlyArray<PersonalBestView> {
  return bests.map(toPersonalBestView);
}
