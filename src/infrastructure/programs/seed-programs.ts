/**
 * Seed training programs for Fit40.
 *
 * Programs are authored as raw data, built through domain factories, and then
 * cross-checked against the seed exercise catalog. Invalid construction or a
 * missing exercise reference throws at module load (fail fast).
 */

import { createTrainingProgram } from '@/domain/entities/training-program';
import type {
  CreateTrainingProgramInput,
  ProgramWeek,
  TrainingProgram,
} from '@/domain/entities/training-program';
import { createWorkout, type Workout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import type { ExerciseId } from '@/domain/types/ids';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import {
  createDurationScheme,
  createRepScheme,
  type RepPrescription,
} from '@/domain/value-objects/rep-prescription';
import { seedExercises } from '@/infrastructure/exercises/seed-exercises';

function exerciseId(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

const EXERCISE_IDS = {
  bodyweightSquat: exerciseId('ex-001'),
  gobletSquat: exerciseId('ex-002'),
  splitSquat: exerciseId('ex-003'),
  dumbbellRomanianDeadlift: exerciseId('ex-004'),
  gluteBridge: exerciseId('ex-005'),
  inclinePushUp: exerciseId('ex-006'),
  pushUp: exerciseId('ex-007'),
  dumbbellBenchPress: exerciseId('ex-008'),
  dumbbellOverheadPress: exerciseId('ex-009'),
  oneArmDumbbellRow: exerciseId('ex-010'),
  resistanceBandRow: exerciseId('ex-011'),
  latPulldown: exerciseId('ex-012'),
  assistedPullUp: exerciseId('ex-013'),
  farmerCarry: exerciseId('ex-014'),
  deadBug: exerciseId('ex-015'),
  birdDog: exerciseId('ex-016'),
  pallofPress: exerciseId('ex-017'),
} as const;

type ExerciseRef = (typeof EXERCISE_IDS)[keyof typeof EXERCISE_IDS];

function rx(sets: number, minReps: number, maxReps: number): RepPrescription {
  const result = createRepScheme(sets, minReps, maxReps);
  if (!result.ok) throw new Error(`Invalid rep scheme: ${result.error.message}`);
  return result.data;
}

function dur(sets: number, seconds: number): RepPrescription {
  const result = createDurationScheme(sets, seconds);
  if (!result.ok) throw new Error(`Invalid duration scheme: ${result.error.message}`);
  return result.data;
}

function we(
  exerciseId: ExerciseRef,
  order: number,
  prescription: RepPrescription,
  restSeconds: number,
  notes?: string,
) {
  return { exerciseId, order, prescription, restSeconds, notes: notes ?? null };
}

function buildWorkout(
  id: string,
  name: string,
  slug: string,
  description: string,
  estimatedDurationMinutes: number,
  exercises: Workout['exercises'],
): Workout {
  const result = createWorkout({
    id,
    name,
    slug,
    description,
    estimatedDurationMinutes,
    exercises,
  });

  if (!result.ok) {
    throw new Error(`Invalid seed workout "${slug}": ${result.error.message}`);
  }

  return result.data;
}

function buildProgram(
  id: string,
  name: string,
  slug: string,
  input: Omit<CreateTrainingProgramInput, 'id' | 'name' | 'slug'>,
): TrainingProgram {
  const result = createTrainingProgram({ id, name, slug, ...input });
  if (!result.ok) {
    throw new Error(`Invalid seed program "${slug}": ${result.error.message}`);
  }
  return result.data;
}

function generateSchedule(
  programSlug: string,
  durationWeeks: number,
  workoutTemplates: ReadonlyArray<Workout>,
): ReadonlyArray<ProgramWeek> {
  return Array.from({ length: durationWeeks }, (_, weekIndex) => {
    const weekNumber = weekIndex + 1;
    return {
      weekNumber,
      scheduledWorkouts: workoutTemplates.map((workout, workoutIndex) => {
        const occurrenceId = `${programSlug}-w${weekNumber}-${workoutIndex + 1}`;
        const idResult = createScheduledWorkoutId(occurrenceId);
        if (!idResult.ok) {
          throw new Error(`Invalid scheduled workout id "${occurrenceId}": ${idResult.error.message}`);
        }
        return {
          id: idResult.data,
          workoutId: workout.id,
          order: workoutIndex + 1,
        };
      }),
    };
  });
}

// ─── Fit40 Beginner Strength ────────────────────────────────────────────────

const beginnerStrengthA = buildWorkout(
  'wo-beginner-strength-a',
  'Full Body A',
  'full-body-a',
  'A gym-based full-body session emphasizing squat, press, hinge, and core.',
  45,
  [
    we(EXERCISE_IDS.gobletSquat, 1, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.dumbbellBenchPress, 2, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.oneArmDumbbellRow, 3, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.farmerCarry, 4, dur(3, 30), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const beginnerStrengthB = buildWorkout(
  'wo-beginner-strength-b',
  'Full Body B',
  'full-body-b',
  'A bodyweight-focused session with band rows and glute work.',
  40,
  [
    we(EXERCISE_IDS.bodyweightSquat, 1, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.pushUp, 2, rx(3, 6, 10), 90),
    we(EXERCISE_IDS.resistanceBandRow, 3, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.gluteBridge, 4, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.birdDog, 5, rx(3, 8, 10), 60),
  ],
);

const beginnerStrengthC = buildWorkout(
  'wo-beginner-strength-c',
  'Full Body C',
  'full-body-c',
  'A pull- and hinge-focused session with vertical pulling and anti-rotation core.',
  45,
  [
    we(EXERCISE_IDS.dumbbellRomanianDeadlift, 1, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.dumbbellOverheadPress, 2, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.latPulldown, 3, rx(3, 10, 12), 90),
    we(EXERCISE_IDS.pallofPress, 4, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const beginnerStrengthProgram = buildProgram(
  'prog-beginner-strength',
  'Fit40 Beginner Strength',
  'fit40-beginner-strength',
  {
    description:
      'A 6-week introductory strength program for adults 40+. Three full-body sessions per week build movement competency with dumbbells, machines, and bodyweight.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 6,
    workoutsPerWeek: 3,
    workouts: [beginnerStrengthA, beginnerStrengthB, beginnerStrengthC],
    weeks: generateSchedule('fit40-beginner-strength', 6, [
      beginnerStrengthA,
      beginnerStrengthB,
      beginnerStrengthC,
    ]),
  },
);

// ─── Strong at Home ──────────────────────────────────────────────────────────

const homeA = buildWorkout(
  'wo-home-a',
  'Home Full Body A',
  'home-full-body-a',
  'A home-based session using bodyweight, dumbbells, and a resistance band.',
  40,
  [
    we(EXERCISE_IDS.bodyweightSquat, 1, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.inclinePushUp, 2, rx(3, 8, 12), 60),
    we(EXERCISE_IDS.resistanceBandRow, 3, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.farmerCarry, 4, dur(3, 30), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const homeB = buildWorkout(
  'wo-home-b',
  'Home Full Body B',
  'home-full-body-b',
  'A posterior-chain and core focused home session.',
  40,
  [
    we(EXERCISE_IDS.gluteBridge, 1, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.pushUp, 2, rx(3, 6, 10), 90),
    we(EXERCISE_IDS.oneArmDumbbellRow, 3, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.pallofPress, 4, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.birdDog, 5, rx(3, 8, 10), 60),
  ],
);

const homeC = buildWorkout(
  'wo-home-c',
  'Home Full Body C',
  'home-full-body-c',
  'A loaded home session with dumbbell squat, press, and row.',
  45,
  [
    we(EXERCISE_IDS.gobletSquat, 1, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.dumbbellBenchPress, 2, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.resistanceBandRow, 3, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.farmerCarry, 4, dur(3, 30), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const strongAtHomeProgram = buildProgram(
  'prog-strong-at-home',
  'Strong at Home',
  'strong-at-home',
  {
    description:
      'A 4-week home program using only dumbbells, resistance bands, and bodyweight. Three full-body sessions per week.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.GeneralFitness,
    durationWeeks: 4,
    workoutsPerWeek: 3,
    workouts: [homeA, homeB, homeC],
    weeks: generateSchedule('strong-at-home', 4, [homeA, homeB, homeC]),
  },
);

// ─── Strength & Mobility 40+ ─────────────────────────────────────────────────

const mobilityA = buildWorkout(
  'wo-mobility-a',
  'Mobility & Strength A',
  'mobility-strength-a',
  'A lighter session emphasizing movement quality, rowing, and core stability.',
  35,
  [
    we(EXERCISE_IDS.bodyweightSquat, 1, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.inclinePushUp, 2, rx(3, 8, 12), 60),
    we(EXERCISE_IDS.resistanceBandRow, 3, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.birdDog, 4, rx(3, 8, 10), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const mobilityB = buildWorkout(
  'wo-mobility-b',
  'Mobility & Strength B',
  'mobility-strength-b',
  'A single-leg and hip-focused session with carries and anti-extension core.',
  40,
  [
    we(EXERCISE_IDS.splitSquat, 1, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.gluteBridge, 2, rx(3, 12, 15), 60),
    we(EXERCISE_IDS.pallofPress, 3, rx(3, 10, 12), 60),
    we(EXERCISE_IDS.farmerCarry, 4, dur(3, 30), 60),
    we(EXERCISE_IDS.deadBug, 5, dur(3, 30), 60),
  ],
);

const mobilityC = buildWorkout(
  'wo-mobility-c',
  'Mobility & Strength C',
  'mobility-strength-c',
  'A balanced strength session with squat, overhead press, row, and core.',
  45,
  [
    we(EXERCISE_IDS.gobletSquat, 1, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.inclinePushUp, 2, rx(3, 8, 12), 60),
    we(EXERCISE_IDS.oneArmDumbbellRow, 3, rx(3, 8, 10), 90),
    we(EXERCISE_IDS.birdDog, 4, rx(3, 8, 10), 60),
    we(EXERCISE_IDS.pallofPress, 5, rx(3, 10, 12), 60),
  ],
);

const strengthMobilityProgram = buildProgram(
  'prog-strength-mobility',
  'Strength & Mobility 40+',
  'strength-mobility-40-plus',
  {
    description:
      'A 4-week program blending strength training with mobility-friendly exercise selection. Three sessions per week support adults 40+ in building resilient movement.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.StrengthAndMobility,
    durationWeeks: 4,
    workoutsPerWeek: 3,
    workouts: [mobilityA, mobilityB, mobilityC],
    weeks: generateSchedule('strength-mobility-40-plus', 4, [mobilityA, mobilityB, mobilityC]),
  },
);

// ─── Integrity check & export ───────────────────────────────────────────────

const seedProgramsRaw: ReadonlyArray<TrainingProgram> = [
  beginnerStrengthProgram,
  strongAtHomeProgram,
  strengthMobilityProgram,
];

const validExerciseIds = new Set(seedExercises.map((exercise) => exercise.id));

for (const program of seedProgramsRaw) {
  for (const workout of program.workouts) {
    for (const workoutExercise of workout.exercises) {
      if (!validExerciseIds.has(workoutExercise.exerciseId)) {
        throw new Error(
          `Seed program "${program.slug}" references unknown exercise id "${workoutExercise.exerciseId}"`,
        );
      }
    }
  }
}

export const seedPrograms: ReadonlyArray<TrainingProgram> = seedProgramsRaw;