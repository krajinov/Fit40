import {
  createDurationScheme,
  createRepScheme,
  type RepPrescription,
} from '@/domain/value-objects/rep-prescription';

/**
 * Column shape shared by `workout_exercises` and `exercise_logs` for storing a
 * prescription as a type discriminator plus nullable variant columns.
 */
export interface PrescriptionColumns {
  readonly prescriptionType: string;
  readonly sets: number;
  readonly minReps: number | null;
  readonly maxReps: number | null;
  readonly durationSeconds: number | null;
}

/**
 * Maps a domain prescription to its persistable column values.
 */
export function prescriptionToColumns(prescription: RepPrescription): PrescriptionColumns {
  if (prescription.type === 'reps') {
    return {
      prescriptionType: 'reps',
      sets: prescription.sets,
      minReps: prescription.minReps,
      maxReps: prescription.maxReps,
      durationSeconds: null,
    };
  }

  return {
    prescriptionType: 'duration',
    sets: prescription.sets,
    minReps: null,
    maxReps: null,
    durationSeconds: prescription.seconds,
  };
}

/**
 * Reconstructs a domain prescription from persisted columns.
 *
 * Throws with the provided context when the columns cannot form a valid
 * prescription. The DB CHECK constraint makes this unreachable through normal
 * writes, so a failure here indicates data corruption.
 */
export function prescriptionFromColumns(
  columns: PrescriptionColumns,
  context: string,
): RepPrescription {
  let result;

  if (columns.prescriptionType === 'reps') {
    if (columns.minReps === null || columns.maxReps === null) {
      throw new Error(`Corrupt data in ${context}: reps prescription missing minReps/maxReps`);
    }
    result = createRepScheme(columns.sets, columns.minReps, columns.maxReps);
  } else if (columns.prescriptionType === 'duration') {
    if (columns.durationSeconds === null) {
      throw new Error(`Corrupt data in ${context}: duration prescription missing durationSeconds`);
    }
    result = createDurationScheme(columns.sets, columns.durationSeconds);
  } else {
    throw new Error(
      `Corrupt data in ${context}: unknown prescription_type "${columns.prescriptionType}"`,
    );
  }

  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }

  return result.data;
}
