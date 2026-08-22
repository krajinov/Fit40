/**
 * URL search-parameter validation boundary for the exercise catalog filters.
 *
 * Invalid enum values are silently dropped so a malformed query string never
 * crashes the page. The output is the domain's ExerciseFilterCriteria.
 */

import { z } from 'zod';

import type { ExerciseFilterCriteria } from '@/domain/types/exercise';
import {
  DIFFICULTY_VALUES,
  EQUIPMENT_VALUES,
  MUSCLE_GROUP_VALUES,
} from '@/domain/types/exercise';

/**
 * Zod requires a non-empty tuple for z.enum. The domain *_VALUES arrays are
 * readonly literal unions, so a cast is necessary and safe here.
 */
const equipmentValueSchema = z.enum(EQUIPMENT_VALUES as [string, ...string[]]);
const muscleGroupValueSchema = z.enum(MUSCLE_GROUP_VALUES as [string, ...string[]]);
const difficultyValueSchema = z.enum(DIFFICULTY_VALUES as [string, ...string[]]);

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const exerciseSlugSchema = z.string().regex(SLUG_PATTERN);

function toStringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Parses raw URL search params into a validated ExerciseFilterCriteria.
 *
 * URL param names (concise/conventional) are mapped to criteria field names:
 * - equipment -> equipment
 * - muscle -> muscleGroups
 * - difficulty -> difficulties
 */
export function parseExerciseFilters(
  searchParams: Record<string, string | string[] | undefined>,
): ExerciseFilterCriteria {
  const rawEquipment = toStringArray(searchParams.equipment);
  const rawMuscle = toStringArray(searchParams.muscle);
  const rawDifficulty = toStringArray(searchParams.difficulty);

  const equipment = unique(
    rawEquipment.filter((value) => equipmentValueSchema.safeParse(value).success),
  ) as ExerciseFilterCriteria['equipment'];

  const muscleGroups = unique(
    rawMuscle.filter((value) => muscleGroupValueSchema.safeParse(value).success),
  ) as ExerciseFilterCriteria['muscleGroups'];

  const difficulties = unique(
    rawDifficulty.filter((value) => difficultyValueSchema.safeParse(value).success),
  ) as ExerciseFilterCriteria['difficulties'];

  return { equipment, muscleGroups, difficulties };
}