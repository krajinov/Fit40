/**
 * Presentation labels and filter option lists for the exercise catalog.
 *
 * This is a presentation concern used by both Server and Client Components.
 */

import type {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';
import {
  Difficulty as DifficultyType,
  EquipmentType as EquipmentTypeEnum,
  MovementPattern as MovementPatternType,
  MuscleGroup as MuscleGroupType,
  PhysicalConsideration as PhysicalConsiderationType,
  SuitabilityLevel as SuitabilityLevelType,
} from '@/domain/types/exercise';

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  [MuscleGroupType.Chest]: 'Chest',
  [MuscleGroupType.Back]: 'Back',
  [MuscleGroupType.Shoulders]: 'Shoulders',
  [MuscleGroupType.Quadriceps]: 'Quadriceps',
  [MuscleGroupType.Hamstrings]: 'Hamstrings',
  [MuscleGroupType.Glutes]: 'Glutes',
  [MuscleGroupType.Calves]: 'Calves',
  [MuscleGroupType.Biceps]: 'Biceps',
  [MuscleGroupType.Triceps]: 'Triceps',
  [MuscleGroupType.Core]: 'Core',
  [MuscleGroupType.FullBody]: 'Full body',
};

export const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  [EquipmentTypeEnum.Bodyweight]: 'Bodyweight',
  [EquipmentTypeEnum.Dumbbell]: 'Dumbbell',
  [EquipmentTypeEnum.Barbell]: 'Barbell',
  [EquipmentTypeEnum.ResistanceBand]: 'Resistance band',
  [EquipmentTypeEnum.Kettlebell]: 'Kettlebell',
  [EquipmentTypeEnum.Bench]: 'Bench',
  [EquipmentTypeEnum.Machine]: 'Machine',
  [EquipmentTypeEnum.PullUpBar]: 'Pull-up bar',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [DifficultyType.Beginner]: 'Beginner',
  [DifficultyType.Intermediate]: 'Intermediate',
  [DifficultyType.Advanced]: 'Advanced',
};

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  [MovementPatternType.Squat]: 'Squat',
  [MovementPatternType.Hinge]: 'Hinge',
  [MovementPatternType.PushHorizontal]: 'Push horizontal',
  [MovementPatternType.PushVertical]: 'Push vertical',
  [MovementPatternType.PullHorizontal]: 'Pull horizontal',
  [MovementPatternType.PullVertical]: 'Pull vertical',
  [MovementPatternType.Carry]: 'Carry',
  [MovementPatternType.Core]: 'Core',
  [MovementPatternType.Isolation]: 'Isolation',
  [MovementPatternType.Locomotion]: 'Locomotion',
};

export interface FilterOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export const EQUIPMENT_OPTIONS: FilterOption<EquipmentType>[] =
  Object.entries(EQUIPMENT_LABELS).map(([value, label]) => ({
    value: value as EquipmentType,
    label,
  }));

export const MUSCLE_GROUP_OPTIONS: FilterOption<MuscleGroup>[] =
  Object.entries(MUSCLE_GROUP_LABELS).map(([value, label]) => ({
    value: value as MuscleGroup,
    label,
  }));

export const DIFFICULTY_OPTIONS: FilterOption<Difficulty>[] =
  Object.entries(DIFFICULTY_LABELS).map(([value, label]) => ({
    value: value as Difficulty,
    label,
  }));

export const PHYSICAL_CONSIDERATION_LABELS: Record<PhysicalConsideration, string> = {
  [PhysicalConsiderationType.KneeSensitive]: 'Knee sensitivity',
  [PhysicalConsiderationType.LowerBackSensitive]: 'Lower back sensitivity',
  [PhysicalConsiderationType.ShoulderSensitive]: 'Shoulder sensitivity',
  [PhysicalConsiderationType.LimitedMobility]: 'Limited mobility',
};

export const SUITABILITY_LABELS: Record<SuitabilityLevel, string> = {
  [SuitabilityLevelType.Suitable]: 'Suitable',
  [SuitabilityLevelType.Caution]: 'Use caution',
  [SuitabilityLevelType.Unsuitable]: 'May be unsuitable',
};