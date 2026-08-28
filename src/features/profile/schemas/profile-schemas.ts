/**
 * Boundary validation for the onboarding and profile-edit forms.
 *
 * Server-side validation is authoritative: every field is re-validated here on
 * submission regardless of any client-side hints. Domain range constants are
 * imported from the domain layer so boundary and factory rules cannot drift.
 *
 * Weight is collected with a presentation-only unit selector (`kg`/`lb`) and
 * converted to canonical kilograms here, the same way `confirmPassword` is a
 * presentation-only field in the auth schemas. The unit never reaches the
 * domain or the database.
 */

import { z } from 'zod';

import {
  approximateAgeInYears,
  PROFILE_DAYS_PER_WEEK_MAX,
  PROFILE_DAYS_PER_WEEK_MIN,
  PROFILE_HEIGHT_CM_MAX,
  PROFILE_HEIGHT_CM_MIN,
  PROFILE_MAX_AGE,
  PROFILE_MIN_AGE,
  PROFILE_SESSION_MINUTES_MAX,
  PROFILE_SESSION_MINUTES_MIN,
  PROFILE_WEIGHT_KG_MAX,
  PROFILE_WEIGHT_KG_MIN,
} from '@/domain/entities/user-profile';
import { EQUIPMENT_VALUES, PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import type { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { PROGRAM_GOAL_VALUES, type ProgramGoal } from '@/domain/types/program';
import { EXPERIENCE_LEVEL_VALUES, type ExperienceLevel } from '@/domain/types/profile';

export const WEIGHT_UNITS = ['kg', 'lb'] as const;

const LB_PER_KG = 2.2046226218;

// ─── Field schemas ─────────────────────────────────────────────────────────────

const birthYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, 'Enter the year you were born, e.g. 1980.')
  .transform(Number)
  .refine((year) => approximateAgeInYears(year, new Date()) >= PROFILE_MIN_AGE, {
    message: `Fit40 is designed for adults. You must be at least ${PROFILE_MIN_AGE} to create a profile.`,
  })
  .refine((year) => approximateAgeInYears(year, new Date()) <= PROFILE_MAX_AGE, {
    message: 'Please check your birth year.',
  });

// Zod requires a non-empty tuple for z.enum. The domain *_VALUES arrays are
// readonly literal unions, so a cast is necessary and safe here.
const experienceLevelSchema = z.enum(EXPERIENCE_LEVEL_VALUES as [string, ...string[]], {
  message: 'Select your training experience.',
});

const primaryGoalSchema = z.enum(PROGRAM_GOAL_VALUES as [string, ...string[]], {
  message: 'Select your primary training goal.',
});

const equipmentValueSchema = z.enum(EQUIPMENT_VALUES as [string, ...string[]], {
  message: 'Unknown equipment value.',
});

const availableEquipmentSchema = z
  .array(equipmentValueSchema)
  .min(1, 'Select at least one piece of equipment you have access to.')
  // Duplicate checkbox submissions are a harness/bug concern, not user intent:
  // dedupe at the boundary and let the domain uniqueness invariant stand.
  .transform((values) => [...new Set(values)]);

const considerationValueSchema = z.enum(PHYSICAL_CONSIDERATION_VALUES as [string, ...string[]], {
  message: 'Unknown consideration value.',
});

const physicalConsiderationsSchema = z
  .array(considerationValueSchema)
  .transform((values) => [...new Set(values)]);

const daysPerWeekSchema = z.coerce
  .number({ message: 'Choose how many days per week you want to train.' })
  .int()
  .min(
    PROFILE_DAYS_PER_WEEK_MIN,
    `Training days must be between ${PROFILE_DAYS_PER_WEEK_MIN} and ${PROFILE_DAYS_PER_WEEK_MAX}.`,
  )
  .max(
    PROFILE_DAYS_PER_WEEK_MAX,
    `Training days must be between ${PROFILE_DAYS_PER_WEEK_MIN} and ${PROFILE_DAYS_PER_WEEK_MAX}.`,
  );

const sessionMinutesSchema = z.coerce
  .number({ message: 'Choose your preferred session length.' })
  .int()
  .min(
    PROFILE_SESSION_MINUTES_MIN,
    `Session length must be between ${PROFILE_SESSION_MINUTES_MIN} and ${PROFILE_SESSION_MINUTES_MAX} minutes.`,
  )
  .max(
    PROFILE_SESSION_MINUTES_MAX,
    `Session length must be between ${PROFILE_SESSION_MINUTES_MIN} and ${PROFILE_SESSION_MINUTES_MAX} minutes.`,
  );

const heightCmSchema = z
  .string()
  .trim()
  // Empty input means "not provided"; anything else must parse as a number.
  .transform((value): number | null => (value === '' ? null : Number(value)))
  .pipe(
    z.union([
      z.null(),
      z
        .number()
        .int('Height must be a whole number of centimeters.')
        .min(PROFILE_HEIGHT_CM_MIN, `Height must be between ${PROFILE_HEIGHT_CM_MIN} and ${PROFILE_HEIGHT_CM_MAX} cm.`)
        .max(PROFILE_HEIGHT_CM_MAX, `Height must be between ${PROFILE_HEIGHT_CM_MIN} and ${PROFILE_HEIGHT_CM_MAX} cm.`),
    ]),
  );

const weightKgSchema = z
  .object({
    weightValue: z.coerce
      .number({ message: 'Enter your weight.' })
      .finite()
      .positive('Enter your weight.'),
    weightUnit: z.enum(WEIGHT_UNITS, { message: 'Select a weight unit.' }),
  })
  .transform((data) =>
    data.weightUnit === 'kg' ? data.weightValue : data.weightValue / LB_PER_KG,
  )
  .transform((kg) => Math.round(kg * 10) / 10)
  .pipe(
    z
      .number()
      .min(PROFILE_WEIGHT_KG_MIN, `Weight must be between ${PROFILE_WEIGHT_KG_MIN} and ${PROFILE_WEIGHT_KG_MAX} kg.`)
      .max(PROFILE_WEIGHT_KG_MAX, `Weight must be between ${PROFILE_WEIGHT_KG_MIN} and ${PROFILE_WEIGHT_KG_MAX} kg.`),
  );

export const profileFormSchema = z.object({
  birthYear: birthYearSchema,
  experienceLevel: experienceLevelSchema,
  primaryGoal: primaryGoalSchema,
  availableEquipment: availableEquipmentSchema,
  physicalConsiderations: physicalConsiderationsSchema,
  preferredDaysPerWeek: daysPerWeekSchema,
  preferredSessionMinutes: sessionMinutesSchema,
  heightCm: heightCmSchema,
  weight: weightKgSchema,
});

// ─── Output mapping ────────────────────────────────────────────────────────────

export interface ParsedProfileForm {
  birthYear: number;
  experienceLevel: ExperienceLevel;
  primaryGoal: ProgramGoal;
  availableEquipment: ReadonlyArray<EquipmentType>;
  physicalConsiderations: ReadonlyArray<PhysicalConsideration>;
  preferredDaysPerWeek: number;
  preferredSessionMinutes: number;
  heightCm: number | null;
  weightKg: number;
}

/**
 * Narrows the validated schema output to domain types.
 *
 * Zod validated membership of every enum value against the authoritative
 * *_VALUES lists above, so these casts only restore the literal-union types
 * the widening `as [string, ...string[]]` cast erased.
 */
export function toProfileFormOutput(
  data: z.output<typeof profileFormSchema>,
): ParsedProfileForm {
  return {
    birthYear: data.birthYear,
    experienceLevel: data.experienceLevel as ExperienceLevel,
    primaryGoal: data.primaryGoal as ProgramGoal,
    availableEquipment: data.availableEquipment as ReadonlyArray<EquipmentType>,
    physicalConsiderations: data.physicalConsiderations as ReadonlyArray<PhysicalConsideration>,
    preferredDaysPerWeek: data.preferredDaysPerWeek,
    preferredSessionMinutes: data.preferredSessionMinutes,
    heightCm: data.heightCm,
    weightKg: data.weight,
  };
}

// ─── FormData extraction ───────────────────────────────────────────────────────

function asString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(values: Array<FormDataEntryValue>): string[] {
  return values.map((value) => (typeof value === 'string' ? value : ''));
}

/**
 * Extracts the shape profileFormSchema expects from a native form submission.
 */
export function parseProfileFormData(formData: FormData) {
  return {
    birthYear: asString(formData.get('birthYear')),
    experienceLevel: asString(formData.get('experienceLevel')),
    primaryGoal: asString(formData.get('primaryGoal')),
    availableEquipment: asStringArray(formData.getAll('availableEquipment')),
    physicalConsiderations: asStringArray(formData.getAll('physicalConsiderations')),
    preferredDaysPerWeek: asString(formData.get('preferredDaysPerWeek')),
    preferredSessionMinutes: asString(formData.get('preferredSessionMinutes')),
    heightCm: asString(formData.get('heightCm')),
    weight: {
      weightValue: asString(formData.get('weightValue')),
      weightUnit: asString(formData.get('weightUnit')),
    },
  };
}

/**
 * Echoes the submitted values back to the client so the form can preserve them
 * across expected errors. Profile fields carry no sensitive data, so echoing
 * the full set is safe.
 */
export function echoProfileFormData(formData: FormData) {
  return {
    birthYear: asString(formData.get('birthYear')),
    experienceLevel: asString(formData.get('experienceLevel')),
    primaryGoal: asString(formData.get('primaryGoal')),
    availableEquipment: asStringArray(formData.getAll('availableEquipment')),
    physicalConsiderations: asStringArray(formData.getAll('physicalConsiderations')),
    preferredDaysPerWeek: asString(formData.get('preferredDaysPerWeek')),
    preferredSessionMinutes: asString(formData.get('preferredSessionMinutes')),
    heightCm: asString(formData.get('heightCm')),
    weightValue: asString(formData.get('weightValue')),
    weightUnit: asString(formData.get('weightUnit')),
  };
}

export function flattenFieldErrors(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}
