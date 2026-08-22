/**
 * Presentation labels and formatting helpers for training programs.
 */

import type { ProgramGoal } from '@/domain/types/program';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

export const PROGRAM_GOAL_LABELS: Record<ProgramGoal, string> = {
  strength: 'Strength',
  hypertrophy: 'Hypertrophy',
  endurance: 'Endurance',
  mobility: 'Mobility',
  'general-fitness': 'General fitness',
  'weight-loss': 'Weight loss',
  'strength-and-mobility': 'Strength & mobility',
};

/**
 * Formats a rep prescription for display.
 *
 * Examples:
 * - 3 × 8
 * - 3 × 8–10
 * - 3 × 30s
 */
export function formatPrescription(prescription: RepPrescription): string {
  if (prescription.type === 'duration') {
    return `${prescription.sets} × ${prescription.seconds}s`;
  }

  const repRange =
    prescription.minReps === prescription.maxReps
      ? String(prescription.minReps)
      : `${prescription.minReps}–${prescription.maxReps}`;

  return `${prescription.sets} × ${repRange}`;
}

/**
 * Formats a duration in minutes for display.
 */
export function formatDuration(minutes: number): string {
  return `${minutes} min`;
}