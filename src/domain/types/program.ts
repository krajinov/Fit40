/**
 * Domain enums and value lists for training programs.
 *
 * Uses the const-object pattern instead of TypeScript enums.
 */

/**
 * High-level goal or focus of a training program.
 */
export const ProgramGoal = {
  Strength: 'strength',
  Hypertrophy: 'hypertrophy',
  Endurance: 'endurance',
  Mobility: 'mobility',
  GeneralFitness: 'general-fitness',
  WeightLoss: 'weight-loss',
  StrengthAndMobility: 'strength-and-mobility',
} as const;

export type ProgramGoal = (typeof ProgramGoal)[keyof typeof ProgramGoal];

export const PROGRAM_GOAL_VALUES = Object.values(ProgramGoal) as ReadonlyArray<ProgramGoal>;