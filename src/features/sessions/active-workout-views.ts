/**
 * PURE presentation mapping for the Active Workout screen: exercise cards,
 * badges, set rows and the session progress summary.
 *
 * This module formats decisions the session snapshot already made; it never
 * re-derives progression decisions (those live in
 * `active-workout-logger-views.ts` and the domain engine). Locked-design
 * semantics:
 *
 * - Rx lines omit rest seconds: the session snapshot does not expose
 *   `restSeconds` (reported gap, never fabricated).
 * - A completed session renders no logger (mutations are in-progress only).
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type {
  WorkoutSessionExerciseDto,
  WorkoutSessionMetricsDto,
  WorkoutSessionSetDto,
} from '@/application/dto/workout-session';
import type { EquipmentType } from '@/domain/types/exercise';
import { formatPrescription } from '@/features/programs/program-labels';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import { formatKg } from '@/features/sessions/workout-target-views';
import {
  buildSessionLoggerView,
  type SessionLoggerView,
} from '@/features/sessions/active-workout-logger-views';

/** How one exercise log is presented on the session screen. */
export type SessionExerciseKind = 'done' | 'active' | 'partial' | 'upcoming';

export interface SessionSetRowView {
  readonly setNumber: number;
  /** e.g. "52.5 kg × 10 @ RPE 7", "40s", "10 kg × 40s @ RPE 8". The RPE
   * suffix is appended only when the set captured an RPE. */
  readonly valueLabel: string;
}

export interface SessionExerciseBadgeView {
  readonly style: 'done' | 'accent' | 'neutral';
  readonly label: string;
  /** The locked mobile frame omits badges on untouched upcoming rows. */
  readonly mobileVisible: boolean;
}

export interface SessionExerciseCardView {
  readonly order: number;
  readonly kind: SessionExerciseKind;
  readonly name: string;
  readonly equipmentLabel: string | null;
  readonly prescriptionLabel: string;
  readonly badge: SessionExerciseBadgeView;
  readonly setRows: ReadonlyArray<SessionSetRowView>;
  /** Null on a completed session (mutations are in-progress only). */
  readonly logger: SessionLoggerView | null;
}

export interface SessionProgressView {
  readonly loggedSets: number;
  readonly prescribedSets: number;
  readonly percentage: number;
  readonly repsLabel: string;
  readonly volumeLabel: string;
}

/**
 * Formats a session timestamp as a 24h clock label ("17:42"), matching the
 * locked design eyebrow. Rendered server-side only; the server's timezone is
 * used because no user-timezone source exists.
 */
export function formatSessionClock(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(isoTimestamp),
  );
}

/** Formats a volume total for the session metrics line ("1,240 kg"). */
export function formatVolumeLabel(volumeKg: number): string {
  return `${Math.round(volumeKg).toLocaleString('en-US')} kg`;
}

function formatSetRowView(set: WorkoutSessionSetDto): SessionSetRowView {
  const valueLabel =
    set.type === 'reps'
      ? set.weightKg !== null
        ? `${formatKg(set.weightKg)} × ${set.reps}`
        : `${set.reps} reps`
      : set.weightKg !== null
        ? `${formatKg(set.weightKg)} × ${set.durationSeconds}s`
        : `${set.durationSeconds}s`;

  return {
    setNumber: set.setNumber,
    // Surface a captured RPE on the row; omit the suffix entirely when unset.
    valueLabel: set.rpe === null ? valueLabel : `${valueLabel} @ RPE ${set.rpe}`,
  };
}

function buildBadge(
  kind: SessionExerciseKind,
  logged: number,
  prescribed: number,
): SessionExerciseBadgeView {
  switch (kind) {
    case 'done':
      return { style: 'done', label: 'Completed', mobileVisible: true };
    case 'active':
      return { style: 'accent', label: 'In progress', mobileVisible: true };
    case 'partial':
      return {
        style: 'neutral',
        label: `${logged} of ${prescribed} sets`,
        mobileVisible: true,
      };
    case 'upcoming':
      return { style: 'neutral', label: 'Upcoming', mobileVisible: false };
  }
}

/** Catalog metadata for one exercise id, resolved server-side. */
export interface SessionExerciseCatalogMeta {
  readonly name: string;
  readonly equipment: EquipmentType;
}

export interface SessionExerciseCardsInput {
  readonly logs: ReadonlyArray<WorkoutSessionExerciseDto>;
  /** Position-aligned with `logs`; null when no target resolved. */
  readonly targets: ReadonlyArray<ExerciseTargetDto | null>;
  readonly catalogByExerciseId: ReadonlyMap<string, SessionExerciseCatalogMeta>;
  readonly sessionStatus: 'in-progress' | 'completed';
}

/**
 * Builds one card view per session exercise log, in log order.
 *
 * `active` is the FIRST log with fewer logged sets than prescribed (an
 * in-progress session only); `partial` covers out-of-order or unfinished
 * work; `upcoming` is untouched. A completed session never marks anything
 * active and carries no logger (mutations are in-progress only).
 */
export function buildSessionExerciseCardViews(
  input: SessionExerciseCardsInput,
): ReadonlyArray<SessionExerciseCardView> {
  const activeOrder =
    input.sessionStatus === 'in-progress'
      ? (input.logs.find((log) => log.sets.length < log.prescription.sets)?.order ?? null)
      : null;

  return input.logs.map((log, index) => {
    const meta = input.catalogByExerciseId.get(log.exerciseId);
    const prescribed = log.prescription.sets;
    const kind: SessionExerciseKind =
      log.sets.length >= prescribed
        ? 'done'
        : log.order === activeOrder
          ? 'active'
          : log.sets.length > 0
            ? 'partial'
            : 'upcoming';

    return {
      order: log.order,
      kind,
      name: meta?.name ?? `Exercise ${log.order}`,
      equipmentLabel: meta === undefined ? null : EQUIPMENT_LABELS[meta.equipment],
      prescriptionLabel: formatPrescription(log.prescription),
      badge: buildBadge(kind, log.sets.length, prescribed),
      setRows: log.sets.map(formatSetRowView),
      logger:
        input.sessionStatus === 'in-progress'
          ? buildSessionLoggerView(log, input.targets[index] ?? null)
          : null,
    };
  });
}

/**
 * Builds the session progress summary from the snapshot prescriptions (the
 * denominator) and the session metrics (the numerator).
 */
export function buildSessionProgress(
  logs: ReadonlyArray<WorkoutSessionExerciseDto>,
  metrics: WorkoutSessionMetricsDto,
): SessionProgressView {
  let prescribedSets = 0;
  for (const log of logs) {
    prescribedSets += log.prescription.sets;
  }

  const percentage =
    prescribedSets === 0
      ? 0
      : Math.min(100, Math.round((metrics.totalSets / prescribedSets) * 100));

  return {
    loggedSets: metrics.totalSets,
    prescribedSets,
    percentage,
    repsLabel: `${metrics.totalReps} reps`,
    volumeLabel: formatVolumeLabel(metrics.volume),
  };
}

