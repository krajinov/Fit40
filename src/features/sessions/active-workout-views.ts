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
 * - A skipped occurrence renders as its own card kind — muted, badged
 *   "Skipped", no logger — and is never the active logger target (M10).
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { ExerciseSubstitutionCandidatesDto } from '@/application/dto/substitution-candidates';
import type {
  WorkoutSessionDto,
  WorkoutSessionExerciseDto,
  WorkoutSessionSetDto,
} from '@/application/dto/workout-session';
import type { EquipmentType } from '@/domain/types/exercise';
import { formatPrescription } from '@/features/programs/program-labels';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import { formatKg } from '@/features/sessions/progression-labels';
import {
  buildSessionLoggerView,
  type SessionLoggerView,
} from '@/features/sessions/active-workout-logger-views';
import {
  buildSessionSubstitutionView,
  type SessionSubstitutionView,
} from '@/features/sessions/session-substitution-views';
import {
  buildSessionAdjustmentView,
  type SessionAdjustmentView,
  SKIPPED_BADGE_LABEL,
} from '@/features/sessions/session-adjustment-views';

/** How one exercise log is presented on the session screen. */
export type SessionExerciseKind = 'done' | 'active' | 'partial' | 'upcoming' | 'skipped';

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
  /**
   * React render identity of this occurrence subtree (PR #13 Finding 2),
   * composed from the occurrence's snapshot identity plus its current order:
   * `${order}:${authoredExerciseId}:${performedExerciseId}`. NOT the bare
   * mutable `order` — after a reorder the same numeric order can identify a
   * DIFFERENT occurrence, and React would otherwise preserve a slot's local
   * state (open loggers, edit drafts, open `<details>`) and hand it to the
   * exercise that now occupies that slot. The composite stays stable across
   * ordinary rerenders of the same occurrence (same order, same identities),
   * changes when another occurrence takes over the order, and distinguishes
   * duplicate-exercise occurrences by their authored/performed pair. It is a
   * presentation-only key — no surrogate occurrence id exists in M10.
   */
  readonly renderKey: string;
  readonly kind: SessionExerciseKind;
  readonly name: string;
  /**
   * The authored exercise's name, shown as "Originally: …" when the
   * occurrence is substituted; null when not substituted, unresolved in the
   * catalog, or the authored id equals the performed one.
   */
  readonly originallyName: string | null;
  readonly equipmentLabel: string | null;
  readonly prescriptionLabel: string;
  readonly badge: SessionExerciseBadgeView;
  readonly setRows: ReadonlyArray<SessionSetRowView>;
  /** Null on a completed session (mutations are in-progress only). */
  readonly logger: SessionLoggerView | null;
  /** The M9 substitution affordance of this occurrence. */
  readonly substitution: SessionSubstitutionView;
  /** The M10 skip affordance of this occurrence. */
  readonly adjustment: SessionAdjustmentView;
}

export interface SessionProgressView {
  readonly loggedSets: number;
  readonly prescribedSets: number;
  /** How many occurrences are skipped; "· N skipped" renders only when > 0. */
  readonly skippedCount: number;
  readonly percentage: number;
  readonly repsLabel: string;
  readonly volumeLabel: string;
}

// ─── Card bands (canonical render order) ─────────────────────────────────────

/**
 * The two render bands of the Active Workout screen. Concatenating
 * `cards` + `upcoming` reproduces the canonical DTO order
 * element-for-element — no sorting ever happens anywhere (PR #13
 * Finding 4).
 */
export interface SessionExerciseCardBands {
  /** The canonical leading band: every card before the last non-upcoming one. */
  readonly cards: ReadonlyArray<SessionExerciseCardView>;
  /** The canonical trailing band: untouched occurrences, all kind === 'upcoming'. */
  readonly upcoming: ReadonlyArray<SessionExerciseCardView>;
}

/**
 * Splits canonically ordered cards into the full-card band and the quiet
 * "Up next" band WITHOUT reordering anything: the cut index is the position
 * AFTER the last card whose kind is not 'upcoming', so the concatenation of
 * the two bands is always element-for-element the input.
 *
 * Why a suffix cut (not the previous "every non-upcoming first" partition):
 * a touched occurrence sitting AFTER an untouched one (e.g. order 3 skipped
 * while order 2 is still upcoming) used to be pulled ahead of it, rendering
 * the DOM as 1, 3, 2 against the canonical 1, 2, 3. Cutting at the last
 * touched position keeps every touched occurrence in place — the untouched
 * occurrence simply renders as a full card with its own quiet affordances
 * instead of a dimmed row — while the untouched suffix keeps the compact
 * "Up next" treatment exactly as before.
 */
export function splitSessionExerciseCardBands(
  cards: ReadonlyArray<SessionExerciseCardView>,
): SessionExerciseCardBands {
  let cut = 0;
  for (let index = 0; index < cards.length; index += 1) {
    if (cards[index]?.kind !== 'upcoming') {
      cut = index + 1;
    }
  }
  return { cards: cards.slice(0, cut), upcoming: cards.slice(cut) };
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
    case 'skipped':
      return { style: 'neutral', label: SKIPPED_BADGE_LABEL, mobileVisible: true };
  }
}

/** Catalog metadata for one exercise id, resolved server-side. */
export interface SessionExerciseCatalogMeta {
  readonly name: string;
  readonly equipment: EquipmentType;
}

export interface SessionExerciseCardsInput {
  readonly logs: ReadonlyArray<WorkoutSessionExerciseDto>;
  /**
   * Position-aligned with `logs`; null when no target resolved or the
   * occurrence is skipped (a target is never requested for one — see
   * `resolveSnapshotTargets` in `active-workout-view.ts`).
   */
  readonly targets: ReadonlyArray<ExerciseTargetDto | null>;
  readonly catalogByExerciseId: ReadonlyMap<string, SessionExerciseCatalogMeta>;
  /**
   * Substitution candidates keyed by performed exercise id, from the ONE
   * catalog read the view assembly performed (see
   * `active-workout-view.ts`). An absent key (performed exercise no longer
   * in the catalog) degrades to the honest no-candidates state.
   */
  readonly candidatesByPerformedExerciseId: ReadonlyMap<
    string,
    ExerciseSubstitutionCandidatesDto
  >;
  readonly sessionStatus: 'in-progress' | 'completed';
}

/**
 * Builds one card view per session exercise log, in log order.
 *
 * `active` is the FIRST non-skipped log with fewer logged sets than
 * prescribed (an in-progress session only); `partial` covers out-of-order or
 * unfinished work; `upcoming` is untouched. A skipped occurrence is its own
 * kind with TOP precedence — never active, never carrying a logger. A
 * completed session never marks anything active and carries no logger
 * (mutations are in-progress only).
 */
export function buildSessionExerciseCardViews(
  input: SessionExerciseCardsInput,
): ReadonlyArray<SessionExerciseCardView> {
  // The active logger target is the FIRST non-skipped log with fewer logged
  // sets than prescribed — the persisted skip decision (`log.isSkipped`,
  // never a zero-set inference) keeps skipped occurrences out of this search.
  const activeOrder =
    input.sessionStatus === 'in-progress'
      ? (input.logs.find(
          (log) => !log.isSkipped && log.sets.length < log.prescription.sets,
        )?.order ?? null)
      : null;

  return input.logs.map((log, index) => {
    const meta = input.catalogByExerciseId.get(log.performedExerciseId);
    const authoredMeta = input.catalogByExerciseId.get(log.authoredExerciseId);
    const prescribed = log.prescription.sets;
    // A skipped occurrence is its own kind with top precedence: it renders
    // skipped regardless of order (and, in invariant-violating fixtures,
    // logged sets) — done/active/partial/upcoming only apply to the rest.
    const kind: SessionExerciseKind = log.isSkipped
      ? 'skipped'
      : log.sets.length >= prescribed
        ? 'done'
        : log.order === activeOrder
          ? 'active'
          : log.sets.length > 0
            ? 'partial'
            : 'upcoming';

    return {
      order: log.order,
      // Presentation-only render identity (PR #13 Finding 2): order + the
      // immutable identity snapshot, so a reorder that seats a different
      // occurrence at this order remounts the subtree instead of reusing
      // the previous occupant's local state. Duplicate occurrences with the
      // same authored AND performed id still share this composite; their
      // identity remains (sessionId, exerciseOrder) in the domain, and the
      // order component of the key already separates them (dense 1..N).
      renderKey: `${log.order}:${log.authoredExerciseId}:${log.performedExerciseId}`,
      kind,
      name: meta?.name ?? `Exercise ${log.order}`,
      // The PERFORMED exercise is the primary identity; the authored name is
      // subtle context only when the domain says this occurrence is
      // substituted AND the catalog resolves the authored exercise. A
      // chained substitution still shows the ORIGINAL authored exercise —
      // authoredExerciseId is never rewritten.
      originallyName:
        log.isSubstituted && authoredMeta !== undefined ? authoredMeta.name : null,
      equipmentLabel: meta === undefined ? null : EQUIPMENT_LABELS[meta.equipment],
      prescriptionLabel: formatPrescription(log.prescription),
      badge: buildBadge(kind, log.sets.length, prescribed),
      setRows: log.sets.map(formatSetRowView),
      // A skipped occurrence carries no logger — and no recommendation
      // callout inside it — even on an in-progress screen: there is nothing
      // to log on a skipped occurrence.
      logger:
        input.sessionStatus === 'in-progress' && !log.isSkipped
          ? buildSessionLoggerView(log, input.targets[index] ?? null)
          : null,
      substitution: buildSessionSubstitutionView({
        eligibility: log.substitutionEligibility,
        candidates:
          input.candidatesByPerformedExerciseId.get(log.performedExerciseId) ?? null,
      }),
      adjustment: buildSessionAdjustmentView(log.adjustmentEligibility),
    };
  });
}

/**
 * Builds the session progress summary from the DOMAIN-OWNED snapshot totals
 * and the session metrics (the numerator).
 *
 * The denominator is `session.prescribedSets` — prescribed sets across the
 * NON-skipped occurrences, computed by the domain
 * (`resolveSessionPrescriptionTotals`) — never re-summed here (F5). The
 * skipped count likewise comes straight from `session.skippedExerciseCount`.
 * Logged metrics and completion semantics are unchanged by skip decisions:
 * a skipped occurrence logs no sets and adds nothing to the numerator.
 */
export function buildSessionProgress(session: WorkoutSessionDto): SessionProgressView {
  const { prescribedSets, skippedExerciseCount, metrics } = session;

  const percentage =
    prescribedSets === 0
      ? 0
      : Math.min(100, Math.round((metrics.totalSets / prescribedSets) * 100));

  return {
    loggedSets: metrics.totalSets,
    prescribedSets,
    skippedCount: skippedExerciseCount,
    percentage,
    repsLabel: `${metrics.totalReps} reps`,
    volumeLabel: formatVolumeLabel(metrics.volume),
  };
}

