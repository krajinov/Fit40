/**
 * UserProfile entity and factories.
 *
 * The fitness profile of an authenticated user: training background, goals,
 * equipment, physical considerations, and schedule preferences. It is the
 * source of user-specific training context for later slices such as program
 * recommendation and personalization. Consumers of those slices read this
 * profile; this entity itself never references them.
 *
 * A UserProfile is intentionally SEPARATE from the auth `User` entity
 * (see src/domain/entities/user.ts): identity is who can sign in, the profile
 * is the person's training context. Identity here is the UserId — exactly one
 * profile exists per user (1:1), enforced by construction and by the database
 * primary key. Fitness attributes must never be added to `User` itself.
 *
 * Age is stored as the birth YEAR, not a full date of birth. Fit40 needs only
 * the era/band a user belongs to (its documented focus is adults 40+), no
 * near-term domain rule requires day precision, and a year is the minimal
 * personal data that satisfies that need.
 *
 * Invariants enforced at construction:
 * - userId must be a valid branded UserId
 * - birthYear must be an integer whose implied age at `updatedAt` is within
 *   [PROFILE_MIN_AGE, PROFILE_MAX_AGE] (age is derived at year granularity,
 *   matching the stored precision; it is never persisted itself)
 * - at least one piece of available equipment, with no duplicates
 * - physical considerations contain no duplicates (empty means "none")
 * - preferredDaysPerWeek is an integer within 1–7
 * - preferredSessionMinutes is an integer within [10, 240]
 * - heightCm is null (not provided) or an integer within [100, 250]
 * - weightKg is a finite number within [30, 400] (canonical kilograms — unit
 *   conversion is a presentation/boundary concern and never reaches the domain)
 * - createdAt and updatedAt are valid dates and updatedAt >= createdAt
 */

import { err, ok, type Result } from '@/lib/result';

import type { UserId } from '@/domain/types/ids';
import { createUserId } from '@/domain/types/ids';
import type { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { EQUIPMENT_VALUES, PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import type { ProgramGoal } from '@/domain/types/program';
import type { ExperienceLevel } from '@/domain/types/profile';

// ─── Invariant constants (shared with boundary validation) ──────────────────

export const PROFILE_MIN_AGE = 18;
export const PROFILE_MAX_AGE = 120;
export const PROFILE_MIN_BIRTH_YEAR = 1900;
export const PROFILE_DAYS_PER_WEEK_MIN = 1;
export const PROFILE_DAYS_PER_WEEK_MAX = 7;
export const PROFILE_SESSION_MINUTES_MIN = 10;
export const PROFILE_SESSION_MINUTES_MAX = 240;
export const PROFILE_HEIGHT_CM_MIN = 100;
export const PROFILE_HEIGHT_CM_MAX = 250;
export const PROFILE_WEIGHT_KG_MIN = 30;
export const PROFILE_WEIGHT_KG_MAX = 400;

/**
 * A user's fitness profile. Immutable; updates produce a new instance via
 * applyProfileUpdate.
 */
export interface UserProfile {
  readonly userId: UserId;
  readonly birthYear: number;
  readonly experienceLevel: ExperienceLevel;
  readonly primaryGoal: ProgramGoal;
  readonly availableEquipment: ReadonlyArray<EquipmentType>;
  readonly physicalConsiderations: ReadonlyArray<PhysicalConsideration>;
  readonly preferredDaysPerWeek: number;
  readonly preferredSessionMinutes: number;
  readonly heightCm: number | null;
  readonly weightKg: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Input accepted by the createUserProfile factory.
 */
export interface CreateUserProfileInput {
  readonly userId: string;
  readonly birthYear: number;
  readonly experienceLevel: ExperienceLevel;
  readonly primaryGoal: ProgramGoal;
  readonly availableEquipment: ReadonlyArray<EquipmentType>;
  readonly physicalConsiderations: ReadonlyArray<PhysicalConsideration>;
  readonly preferredDaysPerWeek: number;
  readonly preferredSessionMinutes: number;
  readonly heightCm: number | null;
  readonly weightKg: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The editable fields of a profile (everything except identity and audit
 * timestamps).
 */
export interface UserProfileUpdate {
  readonly birthYear: number;
  readonly experienceLevel: ExperienceLevel;
  readonly primaryGoal: ProgramGoal;
  readonly availableEquipment: ReadonlyArray<EquipmentType>;
  readonly physicalConsiderations: ReadonlyArray<PhysicalConsideration>;
  readonly preferredDaysPerWeek: number;
  readonly preferredSessionMinutes: number;
  readonly heightCm: number | null;
  readonly weightKg: number;
}

export interface ProfileValidationError {
  readonly code: 'INVALID_PROFILE';
  readonly message: string;
  readonly field?: string;
}

function invalidProfile(
  message: string,
  field?: string,
): ProfileValidationError {
  return { code: 'INVALID_PROFILE', message, field };
}

const EQUIPMENT_SET = new Set<string>(EQUIPMENT_VALUES);
const CONSIDERATION_SET = new Set<string>(PHYSICAL_CONSIDERATION_VALUES);

/**
 * Derives a user's age from their birth year at a reference date.
 *
 * The stored precision is one year (data minimization), so age is necessarily
 * approximate: this is the age the user turns in the reference date's calendar
 * year. Onboarding/suitability banding only needs this granularity.
 */
export function approximateAgeInYears(birthYear: number, reference: Readonly<Date>): number {
  return reference.getUTCFullYear() - birthYear;
}

/**
 * Creates a validated UserProfile.
 *
 * Returns an error if any invariant is violated (see module header). Malformed
 * persisted data (e.g. array entries outside the equipment or consideration
 * enums) is rejected here even though scalar enum membership is guaranteed by
 * the TypeScript type system, because array contents can only be validated at
 * runtime.
 */
export function createUserProfile(
  input: CreateUserProfileInput,
): Result<UserProfile, ProfileValidationError> {
  const idResult = createUserId(input.userId);
  if (!idResult.ok) {
    return err(invalidProfile(idResult.error.message, 'userId'));
  }

  if (!Number.isInteger(input.birthYear) || input.birthYear < PROFILE_MIN_BIRTH_YEAR) {
    return err(invalidProfile('birthYear must be a valid calendar year', 'birthYear'));
  }

  if (Number.isNaN(input.createdAt.getTime())) {
    return err(invalidProfile('createdAt must be a valid Date', 'createdAt'));
  }

  if (Number.isNaN(input.updatedAt.getTime())) {
    return err(invalidProfile('updatedAt must be a valid Date', 'updatedAt'));
  }

  if (input.updatedAt.getTime() < input.createdAt.getTime()) {
    return err(invalidProfile('updatedAt must not be before createdAt', 'updatedAt'));
  }

  const age = approximateAgeInYears(input.birthYear, input.updatedAt);
  if (age < PROFILE_MIN_AGE) {
    return err(
      invalidProfile(
        `Fit40 is designed for adults: you must be at least ${PROFILE_MIN_AGE} years old`,
        'birthYear',
      ),
    );
  }
  if (age > PROFILE_MAX_AGE) {
    return err(
      invalidProfile(
        `Birth year implies an age above ${PROFILE_MAX_AGE}; please check the value`,
        'birthYear',
      ),
    );
  }

  if (input.availableEquipment.length === 0) {
    return err(
      invalidProfile('availableEquipment must contain at least one item', 'availableEquipment'),
    );
  }

  const uniqueEquipment = new Set<string>(input.availableEquipment);
  if (uniqueEquipment.size !== input.availableEquipment.length) {
    return err(invalidProfile('availableEquipment must not contain duplicates', 'availableEquipment'));
  }

  for (const equipment of input.availableEquipment) {
    if (!EQUIPMENT_SET.has(equipment)) {
      return err(invalidProfile(`Unknown equipment type "${equipment}"`, 'availableEquipment'));
    }
  }

  const uniqueConsiderations = new Set<string>(input.physicalConsiderations);
  if (uniqueConsiderations.size !== input.physicalConsiderations.length) {
    return err(
      invalidProfile(
        'physicalConsiderations must not contain duplicates',
        'physicalConsiderations',
      ),
    );
  }

  for (const consideration of input.physicalConsiderations) {
    if (!CONSIDERATION_SET.has(consideration)) {
      return err(
        invalidProfile(`Unknown physical consideration "${consideration}"`, 'physicalConsiderations'),
      );
    }
  }

  if (
    !Number.isInteger(input.preferredDaysPerWeek) ||
    input.preferredDaysPerWeek < PROFILE_DAYS_PER_WEEK_MIN ||
    input.preferredDaysPerWeek > PROFILE_DAYS_PER_WEEK_MAX
  ) {
    return err(
      invalidProfile(
        `preferredDaysPerWeek must be an integer between ${PROFILE_DAYS_PER_WEEK_MIN} and ${PROFILE_DAYS_PER_WEEK_MAX}`,
        'preferredDaysPerWeek',
      ),
    );
  }

  if (
    !Number.isInteger(input.preferredSessionMinutes) ||
    input.preferredSessionMinutes < PROFILE_SESSION_MINUTES_MIN ||
    input.preferredSessionMinutes > PROFILE_SESSION_MINUTES_MAX
  ) {
    return err(
      invalidProfile(
        `preferredSessionMinutes must be an integer between ${PROFILE_SESSION_MINUTES_MIN} and ${PROFILE_SESSION_MINUTES_MAX}`,
        'preferredSessionMinutes',
      ),
    );
  }

  if (
    input.heightCm !== null &&
    (!Number.isInteger(input.heightCm) ||
      input.heightCm < PROFILE_HEIGHT_CM_MIN ||
      input.heightCm > PROFILE_HEIGHT_CM_MAX)
  ) {
    return err(
      invalidProfile(
        `heightCm must be an integer between ${PROFILE_HEIGHT_CM_MIN} and ${PROFILE_HEIGHT_CM_MAX}, or omitted`,
        'heightCm',
      ),
    );
  }

  if (
    !Number.isFinite(input.weightKg) ||
    input.weightKg < PROFILE_WEIGHT_KG_MIN ||
    input.weightKg > PROFILE_WEIGHT_KG_MAX
  ) {
    return err(
      invalidProfile(
        `weightKg must be a number between ${PROFILE_WEIGHT_KG_MIN} and ${PROFILE_WEIGHT_KG_MAX}`,
        'weightKg',
      ),
    );
  }

  return ok({
    userId: idResult.data,
    birthYear: input.birthYear,
    experienceLevel: input.experienceLevel,
    primaryGoal: input.primaryGoal,
    availableEquipment: input.availableEquipment,
    physicalConsiderations: input.physicalConsiderations,
    preferredDaysPerWeek: input.preferredDaysPerWeek,
    preferredSessionMinutes: input.preferredSessionMinutes,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

/**
 * Applies an update to an existing profile, producing a new instance.
 *
 * Identity (userId) and createdAt are preserved; updatedAt becomes `now` and
 * all invariants are re-validated against the updated fields.
 */
export function applyProfileUpdate(
  profile: UserProfile,
  update: UserProfileUpdate,
  now: Readonly<Date>,
): Result<UserProfile, ProfileValidationError> {
  return createUserProfile({
    userId: profile.userId,
    ...update,
    createdAt: profile.createdAt,
    updatedAt: now,
  });
}
