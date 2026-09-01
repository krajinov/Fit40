/**
 * Presentation mapping for progressive overload targets on the workout
 * detail screen (deferred mapping promised by `RecommendationCallout`'s
 * doc comment — this slice wires the live data).
 *
 * PURE PRESENTATION: this module formats the decisions the domain engine
 * already made. It never calculates progressions, compares reps, or
 * re-derives increase/hold/regress from historical sets — those decisions
 * arrive fully-formed in `ExerciseTargetDto` and their semantics are owned
 * by Domain/Application.
 *
 * Basis → locked design semantics:
 *
 * - increase        accent-tint chip, "TRY TODAY", recommended external load
 * - hold            neutral surface-2 chip, "REPEAT", same target load
 * - regress         restrained amber chip, "TRY TODAY", lower target load;
 *                   `nextLoadKg === null` (regression floor) renders
 *                   "No added load" — never a fake "0 kg"
 * - first-exposure  no chip at all: nothing to recommend and no history to
 *                   show, and the compact locked row stays visually quiet
 * - scheme-change   neutral chip, "NEW REP TARGET" with the current scheme
 *                   (NOT a load: the old scheme's load is not today's
 *                   recommendation)
 * - bodyweight      no chip: the engine progresses externally loaded work,
 *                   not bodyweight reps — the normal prescription stands
 * - duration        no chip: timed work progresses via the scheme, not load
 *
 * The DTO does not expose previous reps, the previous scheme, or
 * lastPerformedAt, so "Last time · 50 kg × 10" cannot be rendered
 * truthfully; the previous LOAD alone (`previousLoadKg`) is shown where the
 * target provides it. That gap is reported, not papered over.
 */

import type { ExerciseTargetDto } from '@/application/dto/exercise';
import type { NextExerciseTarget } from '@/domain/services/exercise-progression';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

/** Visual treatment of a target chip, 1:1 with the locked design states. */
export type TargetChipKind = 'increase' | 'hold' | 'regress' | 'scheme-change';

export interface WorkoutTargetChipView {
  readonly kind: TargetChipKind;
  /** Chip eyebrow, e.g. "TRY TODAY" or "REPEAT". */
  readonly label: string;
  /** Chip value, e.g. "52.5 kg", "3 × 8–10" or "No added load". */
  readonly valueLabel: string;
  /**
   * Screen-reader line conveying the full meaning (not just the label), so
   * the recommendation is understandable without color or context.
   */
  readonly ariaLabel: string;
}

export interface WorkoutExerciseTargetView {
  readonly exerciseId: string;
  /** Previous external load label like "Last time · 50 kg", or null. */
  readonly lastTimeLabel: string | null;
  /** Compact mobile variant of {@link lastTimeLabel} ("Last · 50 kg"). */
  readonly lastTimeCompactLabel: string | null;
  /** Recommendation chip, or null when the basis renders no chip. */
  readonly chip: WorkoutTargetChipView | null;
}

/**
 * Formats a load value for display: trims float dust ("52.50 kg" →
 * "52.5 kg") while keeping half-kilos ("22.5 kg").
 */
export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded} kg`;
}

function schemeLabel(prescription: RepPrescription): string {
  if (prescription.type === 'duration') {
    return `${prescription.sets} × ${prescription.seconds}s`;
  }
  const range =
    prescription.minReps === prescription.maxReps
      ? String(prescription.minReps)
      : `${prescription.minReps}–${prescription.maxReps}`;
  return `${prescription.sets} × ${range}`;
}


function mapTarget(
  target: NextExerciseTarget,
  currentPrescription: RepPrescription,
): WorkoutExerciseTargetView {
  switch (target.basis) {
    case 'increase':
      return {
        exerciseId: '',
        lastTimeLabel: `Last time · ${formatKg(target.previousLoadKg)}`,
        lastTimeCompactLabel: `Last · ${formatKg(target.previousLoadKg)}`,
        chip: {
          kind: 'increase',
          label: 'TRY TODAY',
          valueLabel: formatKg(target.nextLoadKg),
          ariaLabel: `Recommended today: increase to ${formatKg(target.nextLoadKg)} (last time ${formatKg(target.previousLoadKg)})`,
        },
      };
    case 'hold':
      return {
        exerciseId: '',
        lastTimeLabel: `Last time · ${formatKg(target.previousLoadKg)}`,
        lastTimeCompactLabel: `Last · ${formatKg(target.previousLoadKg)}`,
        chip: {
          kind: 'hold',
          label: 'REPEAT',
          valueLabel: formatKg(target.nextLoadKg),
          ariaLabel: `Repeat ${formatKg(target.nextLoadKg)} (same as last time)`,
        },
      };
    case 'regress': {
      const valueLabel =
        target.nextLoadKg === null ? 'No added load' : formatKg(target.nextLoadKg);
      const ariaValue =
        target.nextLoadKg === null
          ? 'no added load'
          : `reduce to ${formatKg(target.nextLoadKg)}`;
      return {
        exerciseId: '',
        lastTimeLabel: `Last time · ${formatKg(target.previousLoadKg)}`,
        lastTimeCompactLabel: `Last · ${formatKg(target.previousLoadKg)}`,
        chip: {
          kind: 'regress',
          label: 'TRY TODAY',
          valueLabel,
          ariaLabel: `Recommended today: ${ariaValue} (last time ${formatKg(target.previousLoadKg)})`,
        },
      };
    }
    case 'scheme-change':
      return {
        exerciseId: '',
        // The previous performance exists (history earned under another
        // scheme) but the DTO exposes no load for it — nothing truthful to
        // show as "Last time".
        lastTimeLabel: null,
        lastTimeCompactLabel: null,
        chip: {
          kind: 'scheme-change',
          label: 'NEW REP TARGET',
          valueLabel: schemeLabel(currentPrescription),
          ariaLabel: `New rep target: ${schemeLabel(currentPrescription)}. Previous performance was under a different scheme`,
        },
      };
    case 'first-exposure':
    case 'bodyweight':
    case 'duration':
      return { exerciseId: '', lastTimeLabel: null, lastTimeCompactLabel: null, chip: null };
  }
}

/**
 * Maps one batched target to its presentation view.
 *
 * `dto` may be null (no target was resolved for this position — e.g. the
 * user is anonymous or personalization failed); the row then renders with
 * neither history nor chip.
 */
export function mapExerciseTargetToView(
  dto: ExerciseTargetDto | null,
  currentPrescription: RepPrescription,
): WorkoutExerciseTargetView {
  if (dto === null) {
    return { exerciseId: '', lastTimeLabel: null, lastTimeCompactLabel: null, chip: null };
  }
  return { ...mapTarget(dto.target, currentPrescription), exerciseId: dto.exerciseId };
}

/**
 * Maps a batch of targets (one per request position, as returned by
 * `GetNextExerciseTargetsUseCase`) zipped with their current
 * prescriptions. Order is preserved by construction: position i of the
 * result corresponds to position i of the requests.
 */
export function mapExerciseTargetsToViews(
  dtos: ReadonlyArray<ExerciseTargetDto | null>,
  currentPrescriptions: ReadonlyArray<RepPrescription>,
): ReadonlyArray<WorkoutExerciseTargetView> {
  return dtos.map((dto, index) =>
    mapExerciseTargetToView(dto, currentPrescriptions[index] as RepPrescription),
  );
}
