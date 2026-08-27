import {
  createDurationScheme,
  createRepScheme,
  type RepPrescription,
} from '@/domain/value-objects/rep-prescription';

export interface PrescriptionRow {
  readonly prescriptionType: 'reps' | 'duration';
  readonly sets: number;
  readonly minReps: number | null;
  readonly maxReps: number | null;
  readonly durationSeconds: number | null;
}

export function prescriptionToDomain(row: PrescriptionRow): RepPrescription {
  if (row.prescriptionType === 'reps') {
    if (row.minReps === null || row.maxReps === null) {
      throw new Error('Corrupt rep prescription: missing min/max reps');
    }

    const result = createRepScheme(row.sets, row.minReps, row.maxReps);
    if (!result.ok) {
      throw new Error(`Corrupt rep prescription: ${result.error.message}`);
    }

    return result.data;
  }

  if (row.durationSeconds === null) {
    throw new Error('Corrupt duration prescription: missing durationSeconds');
  }

  const result = createDurationScheme(row.sets, row.durationSeconds);
  if (!result.ok) {
    throw new Error(`Corrupt duration prescription: ${result.error.message}`);
  }

  return result.data;
}

export function prescriptionToRow(prescription: RepPrescription): PrescriptionRow {
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
