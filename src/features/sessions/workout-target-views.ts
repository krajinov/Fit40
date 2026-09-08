/**
 * Presentation mapping for progressive overload targets on the workout
 * detail screen — the M8 "Row target blocks" (approved Pencil frames
 * "M8 Workout Detail — Desktop/Mobile" and "Fit40 · Design System — M8
 * Progression v2").
 *
 * PURE PRESENTATION: this module formats the decisions the domain engine
 * already made. It never calculates progressions, compares reps, or
 * re-derives increase/hold/regress from historical sets — those decisions
 * arrive fully-formed in `ExerciseTargetDto`, and all UI copy lives in
 * `progression-labels.ts`.
 *
 * Basis → M8 target-block treatments (locked design):
 *
 * - increase        accent-tint block, "NEXT TARGET", next external load
 * - hold            surface-2 block, "NEXT TARGET", same target load
 * - regress         supportive amber block, "NEXT TARGET", lower target
 *                   load; `nextLoadKg === null` (regression floor)
 *                   renders "No added load" — never a fake "0 kg"
 * - scheme-change   neutral card block, "NEW TARGET SCHEME" with the
 *                   current scheme (NOT a load: the old scheme's load is
 *                   not today's recommendation)
 * - bodyweight-goal-reached / bodyweight-hold
 *                   accent-tint "TARGET" block with the authored rep
 *                   target — never an invented load, variation, or
 *                   substitution; goal-reached adds the "Goal reached"
 *                   badge
 * - duration-increase / duration-hold
 *                   "NEXT TARGET" / "TARGET" block with the target seconds
 * - first-exposure  NO block: a quiet "First time · no history yet" line;
 *                   the authored prescription stays primary
 *
 * "Last time" context is rendered truthfully from the DTO's
 * `previousSets` projection (e.g. "Last time · 60 kg × 10, 10, 10");
 * where the DTO carries no comparable previous performance, the context
 * is omitted, never fabricated.
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import {
  bodyweightTargetLabel,
  formatKg,
  formatSeconds,
  lastTimeLabel,
  targetDeltaLabel,
  targetReasonLabel,
} from '@/features/sessions/progression-labels';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

/** Visual treatment of a target block, 1:1 with the M8 design states. */
export type WorkoutTargetBlockKind =
  | 'increase'
  | 'hold'
  | 'regress'
  | 'scheme-change'
  | 'bodyweight-goal-reached'
  | 'bodyweight-hold'
  | 'duration-increase'
  | 'duration-hold';

export interface WorkoutTargetBlockView {
  readonly kind: WorkoutTargetBlockKind;
  /** Block eyebrow, e.g. "NEXT TARGET" or "NEW TARGET SCHEME". */
  readonly eyebrowLabel: string;
  /** Primary value line, e.g. "62.5 kg", "3 × 10–12", "12 reps", "35 sec". */
  readonly valueLabel: string;
  /** Direction line, e.g. "Increase 2.5 kg"; null when the state has none. */
  readonly deltaLabel: string | null;
  /** Deterministic reason sentence (from `progression-labels.ts`). */
  readonly reasonLabel: string;
  /** Only `bodyweight-goal-reached` renders the "Goal reached" badge. */
  readonly showGoalBadge: boolean;
  /**
   * Screen-reader line conveying the full meaning — eyebrow, value, delta
   * and reason — so the recommendation never depends on color or context.
   */
  readonly ariaLabel: string;
}

export interface WorkoutExerciseTargetView {
  readonly exerciseId: string;
  /** Previous performance context like "Last time · 60 kg × 10, 10, 10". */
  readonly lastTimeLabel: string | null;
  /** Quiet first-exposure line ("First time · no history yet"), or null. */
  readonly quietLabel: string | null;
  /** M8 target block, or null when the basis renders none. */
  readonly block: WorkoutTargetBlockView | null;
}

/** The empty view meaning "nothing personalized for this position". */
export const EMPTY_WORKOUT_TARGET: WorkoutExerciseTargetView = {
  exerciseId: '',
  lastTimeLabel: null,
  quietLabel: null,
  block: null,
};

/**
 * The target variants that render an M8 target block. First exposure is
 * deliberately absent: it renders a quiet line, never a block.
 */
type BlockTarget = Exclude<NextExerciseTarget, { readonly basis: 'first-exposure' }>;

/** Maps a decided target to its block kind — 1:1 with the M8 states. */
function blockKindOf(target: BlockTarget): WorkoutTargetBlockKind {
  switch (target.basis) {
    case 'increase':
    case 'hold':
    case 'regress':
    case 'scheme-change':
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
    case 'duration-increase':
    case 'duration-hold':
      return target.basis;
  }
}

/** Eyebrow line per block kind (approved M8 copy). */
function blockEyebrow(kind: WorkoutTargetBlockKind): string {
  switch (kind) {
    case 'increase':
    case 'hold':
    case 'regress':
    case 'duration-increase':
      return 'NEXT TARGET';
    case 'scheme-change':
      return 'NEW TARGET SCHEME';
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
    case 'duration-hold':
      return 'TARGET';
  }
}

/** The primary value line of a block, from the decision's own numbers. */
function blockValueLabel(
  target: BlockTarget,
  currentPrescription: RepPrescription,
): string {
  switch (target.basis) {
    case 'increase':
    case 'hold':
      return formatKg(target.nextLoadKg);
    case 'regress':
      return target.nextLoadKg === null ? 'No added load' : formatKg(target.nextLoadKg);
    case 'scheme-change':
      return formatScheme(currentPrescription);
    case 'bodyweight-goal-reached':
    case 'bodyweight-hold':
      return bodyweightTargetLabel(currentPrescription);
    case 'duration-increase':
    case 'duration-hold':
      return formatSeconds(target.nextSeconds);
  }
}

/** Formats the current prescription as a scheme label ("3 × 10–12", "3 × 30s"). */
function formatScheme(prescription: RepPrescription): string {
  if (prescription.type === 'duration') {
    return `${prescription.sets} × ${prescription.seconds}s`;
  }
  const range =
    prescription.minReps === prescription.maxReps
      ? String(prescription.minReps)
      : `${prescription.minReps}–${prescription.maxReps}`;
  return `${prescription.sets} × ${range}`;
}

/** Builds the M8 target-block view for a decided target. */
function mapBlock(
  target: BlockTarget,
  currentPrescription: RepPrescription,
): WorkoutTargetBlockView {
  const kind = blockKindOf(target);
  const eyebrowLabel = blockEyebrow(kind);
  const valueLabel = blockValueLabel(target, currentPrescription);
  const deltaLabel = targetDeltaLabel(target);
  const reasonLabel = targetReasonLabel(target);
  const parts = [eyebrowLabel, valueLabel];
  if (deltaLabel !== null) {
    parts.push(deltaLabel);
  }
  parts.push(reasonLabel);

  return {
    kind,
    eyebrowLabel,
    valueLabel,
    deltaLabel,
    reasonLabel,
    showGoalBadge: kind === 'bodyweight-goal-reached',
    ariaLabel: parts.join('. '),
  };
}

function mapTarget(
  dto: ExerciseTargetDto,
  currentPrescription: RepPrescription,
): WorkoutExerciseTargetView {
  const target = dto.target;

  if (target.basis === 'first-exposure') {
    // Quiet by design: no block, no history line — the authored
    // prescription stays primary.
    return {
      exerciseId: '',
      lastTimeLabel: null,
      quietLabel: 'First time · no history yet',
      block: null,
    };
  }

  return {
    exerciseId: '',
    lastTimeLabel: lastTimeLabel(target, dto.previousSets),
    quietLabel: null,
    block: mapBlock(target, currentPrescription),
  };
}

/**
 * Maps one batched target to its presentation view.
 *
 * `dto` may be null (no target was resolved for this position — e.g. the
 * user is anonymous or personalization failed); the row then renders with
 * neither history, quiet line, nor block.
 */
export function mapExerciseTargetToView(
  dto: ExerciseTargetDto | null,
  currentPrescription: RepPrescription,
): WorkoutExerciseTargetView {
  if (dto === null) {
    return EMPTY_WORKOUT_TARGET;
  }
  return { ...mapTarget(dto, currentPrescription), exerciseId: dto.exerciseId };
}

/**
 * Maps a batch of targets (one per request position, as returned by
 * `GetNextExerciseTargetsUseCase`) zipped with their current
 * prescriptions. Order is preserved by construction: position i of the
 * result corresponds to position i of the requests. A violated zip
 * contract (mismatched lengths) renders the truthful empty view for every
 * position — a missing prescription is never cast into existence.
 */
export function mapExerciseTargetsToViews(
  dtos: ReadonlyArray<ExerciseTargetDto | null>,
  currentPrescriptions: ReadonlyArray<RepPrescription>,
): ReadonlyArray<WorkoutExerciseTargetView> {
  if (dtos.length !== currentPrescriptions.length) {
    // Defensive: callers zip one prescription per request position (see
    // workout-detail-view.ts), so a mismatch is a caller bug — every row
    // renders the empty view rather than casting a missing prescription.
    return dtos.map(() => EMPTY_WORKOUT_TARGET);
  }
  return dtos.map((dto, index) => {
    const prescription = currentPrescriptions[index];
    return prescription === undefined
      ? EMPTY_WORKOUT_TARGET
      : mapExerciseTargetToView(dto, prescription);
  });
}
