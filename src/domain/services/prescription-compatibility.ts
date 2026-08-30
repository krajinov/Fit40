/**
 * Exact scheme compatibility for progression history: same set type, same
 * set count, and the same per-type targets (min/max reps, or seconds). Any
 * difference means the history was earned under a different scheme and
 * cannot drive the next load.
 */
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export function prescriptionsCompatible(previous: RepPrescription, current: RepPrescription): boolean {
  if (previous.type === 'reps' && current.type === 'reps') {
    return (
      previous.sets === current.sets &&
      previous.minReps === current.minReps &&
      previous.maxReps === current.maxReps
    );
  }

  if (previous.type === 'duration' && current.type === 'duration') {
    return previous.sets === current.sets && previous.seconds === current.seconds;
  }

  return false;
}
