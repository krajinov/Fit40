import type { ConsiderationGuidance, Exercise } from '@/domain/entities/exercise';
import type {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';
import { DIFFICULTY_VALUES } from '@/domain/types/exercise';
import { EQUIPMENT_VALUES } from '@/domain/types/exercise';
import { MOVEMENT_PATTERN_VALUES } from '@/domain/types/exercise';
import { MUSCLE_GROUP_VALUES } from '@/domain/types/exercise';
import { PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import { SUITABILITY_LEVEL_VALUES } from '@/domain/types/exercise';
import type { ExerciseId } from '@/domain/types/ids';

import { exercises } from '../schema/exercises';

type ExerciseRow = typeof exercises.$inferSelect;

export function exerciseToDomain(row: ExerciseRow): Exercise {
  return {
    id: row.id as ExerciseId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    primaryMuscle: parseMuscleGroup(row.primaryMuscle),
    secondaryMuscles: row.secondaryMuscles.map((value) => parseMuscleGroup(value)),
    equipment: parseEquipmentType(row.equipment),
    difficulty: parseDifficulty(row.difficulty),
    movementPattern: parseMovementPattern(row.movementPattern),
    considerations: parseConsiderations(row.considerations),
  };
}

export function exerciseToRow(exercise: Exercise): ExerciseRow {
  return {
    id: exercise.id,
    slug: exercise.slug,
    name: exercise.name,
    description: exercise.description,
    primaryMuscle: exercise.primaryMuscle,
    secondaryMuscles: [...exercise.secondaryMuscles],
    equipment: exercise.equipment,
    difficulty: exercise.difficulty,
    movementPattern: exercise.movementPattern,
    considerations: [...exercise.considerations.map((consideration) => ({ ...consideration }))],
  };
}

function parseMuscleGroup(value: string): MuscleGroup {
  const found = MUSCLE_GROUP_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid muscle group stored in database: ${value}`);
  }
  return found;
}

function parseEquipmentType(value: string): EquipmentType {
  const found = EQUIPMENT_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid equipment type stored in database: ${value}`);
  }
  return found;
}

function parseDifficulty(value: string): Difficulty {
  const found = DIFFICULTY_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid difficulty stored in database: ${value}`);
  }
  return found;
}

function parseMovementPattern(value: string): MovementPattern {
  const found = MOVEMENT_PATTERN_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid movement pattern stored in database: ${value}`);
  }
  return found;
}

function parsePhysicalConsideration(value: string): PhysicalConsideration {
  const found = PHYSICAL_CONSIDERATION_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid physical consideration stored in database: ${value}`);
  }
  return found;
}

function parseSuitabilityLevel(value: string): SuitabilityLevel {
  const found = SUITABILITY_LEVEL_VALUES.find((candidate) => candidate === value);
  if (!found) {
    throw new Error(`Invalid suitability level stored in database: ${value}`);
  }
  return found;
}

function isConsiderationGuidance(value: unknown): value is ConsiderationGuidance {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.consideration === 'string' &&
    typeof record.level === 'string' &&
    PHYSICAL_CONSIDERATION_VALUES.includes(parsePhysicalConsideration(record.consideration)) &&
    SUITABILITY_LEVEL_VALUES.includes(parseSuitabilityLevel(record.level))
  );
}

function parseConsiderations(value: unknown): ReadonlyArray<ConsiderationGuidance> {
  if (!Array.isArray(value)) {
    throw new Error('Invalid considerations stored in database');
  }

  return value.map((item) => {
    if (!isConsiderationGuidance(item)) {
      throw new Error('Invalid consideration guidance stored in database');
    }
    return item;
  });
}
