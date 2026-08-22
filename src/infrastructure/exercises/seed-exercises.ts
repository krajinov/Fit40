/**
 * Seed catalog of exercises for Fit40.
 *
 * This is the concrete, authored data source backing the in-memory repository.
 * Each entry is validated through the domain factory; invalid seed data throws
 * at module load so programming errors fail fast.
 */

import { createExercise, type CreateExerciseInput } from '@/domain/entities/exercise';
import type { Exercise } from '@/domain/entities/exercise';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';

function createSeedExercise(input: CreateExerciseInput): Exercise {
  const result = createExercise(input);
  if (!result.ok) {
    throw new Error(`Invalid seed exercise "${input.slug}": ${result.error.message}`);
  }
  return result.data;
}

const rawExercises: ReadonlyArray<CreateExerciseInput> = [
  {
    id: 'ex-001',
    name: 'Bodyweight Squat',
    slug: 'bodyweight-squat',
    description: 'A foundational lower-body exercise that builds leg strength and mobility using only your body weight.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings, MuscleGroup.Core],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [
      { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
      { consideration: PhysicalConsideration.LimitedMobility, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-002',
    name: 'Goblet Squat',
    slug: 'goblet-squat',
    description: 'A weighted squat holding a single dumbbell at the chest, great for learning squat mechanics.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings, MuscleGroup.Core],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [
      { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-003',
    name: 'Split Squat',
    slug: 'split-squat',
    description: 'A single-leg squat variation that improves balance, stability, and unilateral leg strength.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings, MuscleGroup.Calves],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.Squat,
    considerations: [
      { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
      { consideration: PhysicalConsideration.LimitedMobility, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-004',
    name: 'Dumbbell Romanian Deadlift',
    slug: 'dumbbell-romanian-deadlift',
    description: 'A hip-hinge movement that strengthens the hamstrings, glutes, and back with controlled range.',
    primaryMuscle: MuscleGroup.Hamstrings,
    secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Back, MuscleGroup.Core],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.Hinge,
    considerations: [
      { consideration: PhysicalConsideration.LowerBackSensitive, level: SuitabilityLevel.Caution },
      { consideration: PhysicalConsideration.LimitedMobility, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-005',
    name: 'Glute Bridge',
    slug: 'glute-bridge',
    description: 'A lower-body exercise focused on glute activation with minimal spinal loading.',
    primaryMuscle: MuscleGroup.Glutes,
    secondaryMuscles: [MuscleGroup.Hamstrings, MuscleGroup.Core],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Hinge,
    considerations: [],
  },
  {
    id: 'ex-006',
    name: 'Incline Push-up',
    slug: 'incline-push-up',
    description: 'A beginner-friendly push-up variation with hands elevated to reduce intensity.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Triceps, MuscleGroup.Core],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-007',
    name: 'Push-up',
    slug: 'push-up',
    description: 'A classic bodyweight pressing exercise that builds chest, shoulder, and triceps strength.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Triceps, MuscleGroup.Core],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-008',
    name: 'Dumbbell Bench Press',
    slug: 'dumbbell-bench-press',
    description: 'A horizontal press using dumbbells, allowing a natural range of motion for the chest and shoulders.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Triceps],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-009',
    name: 'Dumbbell Overhead Press',
    slug: 'dumbbell-overhead-press',
    description: 'A vertical press that develops shoulder strength and overhead stability.',
    primaryMuscle: MuscleGroup.Shoulders,
    secondaryMuscles: [MuscleGroup.Triceps, MuscleGroup.Core],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.PushVertical,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Unsuitable },
    ],
  },
  {
    id: 'ex-010',
    name: 'One-arm Dumbbell Row',
    slug: 'one-arm-dumbbell-row',
    description: 'A unilateral rowing exercise that builds back thickness and core stability.',
    primaryMuscle: MuscleGroup.Back,
    secondaryMuscles: [MuscleGroup.Biceps, MuscleGroup.Shoulders, MuscleGroup.Core],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.PullHorizontal,
    considerations: [
      { consideration: PhysicalConsideration.LowerBackSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-011',
    name: 'Resistance Band Row',
    slug: 'resistance-band-row',
    description: 'A beginner pulling exercise using a resistance band to strengthen the back and arms.',
    primaryMuscle: MuscleGroup.Back,
    secondaryMuscles: [MuscleGroup.Biceps, MuscleGroup.Shoulders],
    equipment: EquipmentType.ResistanceBand,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PullHorizontal,
    considerations: [],
  },
  {
    id: 'ex-012',
    name: 'Lat Pulldown',
    slug: 'lat-pulldown',
    description: 'A machine-based vertical pull that targets the latissimus dorsi and upper back.',
    primaryMuscle: MuscleGroup.Back,
    secondaryMuscles: [MuscleGroup.Biceps, MuscleGroup.Shoulders],
    equipment: EquipmentType.Machine,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PullVertical,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-013',
    name: 'Assisted Pull-up',
    slug: 'assisted-pull-up',
    description: 'A scaled pull-up using assistance to build vertical pulling strength progressively.',
    primaryMuscle: MuscleGroup.Back,
    secondaryMuscles: [MuscleGroup.Biceps, MuscleGroup.Shoulders],
    equipment: EquipmentType.Machine,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PullVertical,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-014',
    name: 'Farmer Carry',
    slug: 'farmer-carry',
    description: 'A loaded carry that builds grip strength, posture, and full-body resilience.',
    primaryMuscle: MuscleGroup.FullBody,
    secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Core, MuscleGroup.Back],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Carry,
    considerations: [
      { consideration: PhysicalConsideration.LowerBackSensitive, level: SuitabilityLevel.Caution },
      { consideration: PhysicalConsideration.LimitedMobility, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-015',
    name: 'Dead Bug',
    slug: 'dead-bug',
    description: 'A core exercise that trains trunk stability while keeping the lower back neutral.',
    primaryMuscle: MuscleGroup.Core,
    secondaryMuscles: [],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Core,
    considerations: [],
  },
  {
    id: 'ex-016',
    name: 'Bird Dog',
    slug: 'bird-dog',
    description: 'A quadruped core exercise that improves spinal stability and coordination.',
    primaryMuscle: MuscleGroup.Core,
    secondaryMuscles: [MuscleGroup.Back, MuscleGroup.Glutes, MuscleGroup.Shoulders],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Core,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
  {
    id: 'ex-017',
    name: 'Pallof Press',
    slug: 'pallof-press',
    description: 'An anti-rotation core exercise using a resistance band to resist twisting forces.',
    primaryMuscle: MuscleGroup.Core,
    secondaryMuscles: [MuscleGroup.Shoulders],
    equipment: EquipmentType.ResistanceBand,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.Core,
    considerations: [
      { consideration: PhysicalConsideration.ShoulderSensitive, level: SuitabilityLevel.Caution },
    ],
  },
];

export const seedExercises: ReadonlyArray<Exercise> = rawExercises.map(createSeedExercise);