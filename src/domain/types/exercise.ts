/**
 * Domain enums, value lists, and shared filter types for exercises.
 *
 * Uses the const-object pattern instead of TypeScript enums.
 * Zod schemas in the feature layer consume the exported *_VALUES arrays.
 */

/**
 * Major muscle groups targeted by an exercise.
 */
export const MuscleGroup = {
  Chest: 'chest',
  Back: 'back',
  Shoulders: 'shoulders',
  Quadriceps: 'quadriceps',
  Hamstrings: 'hamstrings',
  Glutes: 'glutes',
  Calves: 'calves',
  Biceps: 'biceps',
  Triceps: 'triceps',
  Core: 'core',
  FullBody: 'full-body',
} as const;

export type MuscleGroup = (typeof MuscleGroup)[keyof typeof MuscleGroup];

export const MUSCLE_GROUP_VALUES = Object.values(MuscleGroup) as ReadonlyArray<MuscleGroup>;

/**
 * Equipment required to perform an exercise.
 */
export const EquipmentType = {
  Bodyweight: 'bodyweight',
  Dumbbell: 'dumbbell',
  Barbell: 'barbell',
  ResistanceBand: 'resistance-band',
  Kettlebell: 'kettlebell',
  Bench: 'bench',
  Machine: 'machine',
  PullUpBar: 'pull-up-bar',
} as const;

export type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType];

export const EQUIPMENT_VALUES = Object.values(EquipmentType) as ReadonlyArray<EquipmentType>;

/**
 * Difficulty level of an exercise.
 */
export const Difficulty = {
  Beginner: 'beginner',
  Intermediate: 'intermediate',
  Advanced: 'advanced',
} as const;

export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const DIFFICULTY_VALUES = Object.values(Difficulty) as ReadonlyArray<Difficulty>;

/**
 * Movement pattern classification used for program design.
 */
export const MovementPattern = {
  Squat: 'squat',
  Hinge: 'hinge',
  PushHorizontal: 'push-horizontal',
  PushVertical: 'push-vertical',
  PullHorizontal: 'pull-horizontal',
  PullVertical: 'pull-vertical',
  Carry: 'carry',
  Core: 'core',
  Isolation: 'isolation',
  Locomotion: 'locomotion',
} as const;

export type MovementPattern = (typeof MovementPattern)[keyof typeof MovementPattern];

export const MOVEMENT_PATTERN_VALUES = Object.values(MovementPattern) as ReadonlyArray<MovementPattern>;

/**
 * Physical considerations that may affect exercise selection for adults 40+.
 * This is training guidance, not a medical recommendation.
 */
export const PhysicalConsideration = {
  KneeSensitive: 'knee-sensitive',
  LowerBackSensitive: 'lower-back-sensitive',
  ShoulderSensitive: 'shoulder-sensitive',
  LimitedMobility: 'limited-mobility',
} as const;

export type PhysicalConsideration =
  (typeof PhysicalConsideration)[keyof typeof PhysicalConsideration];

export const PHYSICAL_CONSIDERATION_VALUES = Object.values(
  PhysicalConsideration,
) as ReadonlyArray<PhysicalConsideration>;

/**
 * Suitability guidance level for a given physical consideration.
 */
const SuitabilityLevelValues = {
  Suitable: 'suitable',
  Caution: 'caution',
  Unsuitable: 'unsuitable',
} as const;

export type SuitabilityLevel =
  (typeof SuitabilityLevelValues)[keyof typeof SuitabilityLevelValues];

export const SuitabilityLevel = SuitabilityLevelValues;

export const SUITABILITY_LEVEL_VALUES = Object.values(
  SuitabilityLevel,
) as ReadonlyArray<SuitabilityLevel>;

/**
 * Criteria for filtering the exercise catalog.
 *
 * An empty array for a dimension means "no filter on that dimension".
 * Within a dimension values are OR-ed; across dimensions values are AND-ed.
 */
export interface ExerciseFilterCriteria {
  readonly equipment: ReadonlyArray<EquipmentType>;
  readonly muscleGroups: ReadonlyArray<MuscleGroup>;
  readonly difficulties: ReadonlyArray<Difficulty>;
}