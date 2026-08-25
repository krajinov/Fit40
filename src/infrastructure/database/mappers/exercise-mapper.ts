import { createExercise, type Exercise } from '@/domain/entities/exercise';
import type { ConsiderationGuidance } from '@/domain/entities/exercise';
import {
  DIFFICULTY_VALUES,
  EQUIPMENT_VALUES,
  MOVEMENT_PATTERN_VALUES,
  MUSCLE_GROUP_VALUES,
  PHYSICAL_CONSIDERATION_VALUES,
  SUITABILITY_LEVEL_VALUES,
  type Difficulty,
  type EquipmentType,
  type MovementPattern,
  type MuscleGroup,
  type PhysicalConsideration,
  type SuitabilityLevel,
} from '@/domain/types/exercise';

import type { exercises } from '../schema/exercises';

type ExerciseRow = typeof exercises.$inferSelect;

const MUSCLE_GROUPS = new Set<string>(MUSCLE_GROUP_VALUES);
const EQUIPMENT = new Set<string>(EQUIPMENT_VALUES);
const DIFFICULTIES = new Set<string>(DIFFICULTY_VALUES);
const MOVEMENT_PATTERNS = new Set<string>(MOVEMENT_PATTERN_VALUES);
const CONSIDERATIONS = new Set<string>(PHYSICAL_CONSIDERATION_VALUES);
const SUITABILITY_LEVELS = new Set<string>(SUITABILITY_LEVEL_VALUES);

function parseMuscleGroup(value: string): MuscleGroup {
  if (!MUSCLE_GROUPS.has(value)) {
    throw new Error(`Corrupt exercise data: unknown muscle group "${value}"`);
  }
  // Safe: membership was validated against the authoritative enum value list.
  return value as MuscleGroup;
}

function parseEquipment(value: string): EquipmentType {
  if (!EQUIPMENT.has(value)) {
    throw new Error(`Corrupt exercise data: unknown equipment "${value}"`);
  }
  return value as EquipmentType;
}

function parseDifficulty(value: string): Difficulty {
  if (!DIFFICULTIES.has(value)) {
    throw new Error(`Corrupt exercise data: unknown difficulty "${value}"`);
  }
  return value as Difficulty;
}

function parseMovementPattern(value: string): MovementPattern {
  if (!MOVEMENT_PATTERNS.has(value)) {
    throw new Error(`Corrupt exercise data: unknown movement pattern "${value}"`);
  }
  return value as MovementPattern;
}

function parseConsiderations(value: unknown): ReadonlyArray<ConsiderationGuidance> {
  if (!Array.isArray(value)) {
    throw new Error('Corrupt exercise data: considerations is not an array');
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Corrupt exercise data: consideration ${index} is not an object`);
    }

    const record = entry as Record<string, unknown>;
    const consideration = record['consideration'];
    const level = record['level'];

    if (typeof consideration !== 'string' || !CONSIDERATIONS.has(consideration)) {
      throw new Error(`Corrupt exercise data: consideration ${index} has invalid consideration`);
    }

    if (typeof level !== 'string' || !SUITABILITY_LEVELS.has(level)) {
      throw new Error(`Corrupt exercise data: consideration ${index} has invalid level`);
    }

    return {
      consideration: consideration as PhysicalConsideration,
      level: level as SuitabilityLevel,
    };
  });
}

/**
 * Reconstructs a domain `Exercise` from a persisted row. Throws when the row
 * cannot satisfy the domain factory invariants.
 */
export function mapExerciseRow(row: ExerciseRow): Exercise {
  const result = createExercise({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    primaryMuscle: parseMuscleGroup(row.primaryMuscle),
    secondaryMuscles: row.secondaryMuscles.map(parseMuscleGroup),
    equipment: parseEquipment(row.equipment),
    difficulty: parseDifficulty(row.difficulty),
    movementPattern: parseMovementPattern(row.movementPattern),
    considerations: parseConsiderations(row.considerations),
  });

  if (!result.ok) {
    throw new Error(`Corrupt exercise row "${row.id}": ${result.error.message}`);
  }

  return result.data;
}

/**
 * Maps a domain `Exercise` to its persistable row shape.
 */
export function mapExerciseToRow(exercise: Exercise): typeof exercises.$inferInsert {
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
    considerations: exercise.considerations,
  };
}
