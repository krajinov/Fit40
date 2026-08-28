/**
 * Domain enums and value lists for user fitness profiles.
 *
 * Uses the const-object pattern instead of TypeScript enums.
 * Zod schemas in the feature layer consume the exported *_VALUES arrays.
 *
 * ExperienceLevel is deliberately a SEPARATE concept from the exercise/program
 * `Difficulty` enum in ./exercise: Difficulty classifies the content of an
 * exercise or program, while ExperienceLevel describes a person's training
 * history. The value sets happen to coincide today, but the semantics differ
 * and each must be free to evolve independently (e.g. programs gaining extra
 * difficulty tiers must not silently redefine user experience levels).
 */

/**
 * Self-described training experience level of a user.
 */
export const ExperienceLevel = {
  Beginner: 'beginner',
  Intermediate: 'intermediate',
  Advanced: 'advanced',
} as const;

export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel];

export const EXPERIENCE_LEVEL_VALUES = Object.values(
  ExperienceLevel,
) as ReadonlyArray<ExperienceLevel>;
