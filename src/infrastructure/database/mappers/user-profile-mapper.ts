import { createUserProfile, type UserProfile } from '@/domain/entities/user-profile';
import { EQUIPMENT_VALUES, PHYSICAL_CONSIDERATION_VALUES } from '@/domain/types/exercise';
import type { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { PROGRAM_GOAL_VALUES, type ProgramGoal } from '@/domain/types/program';
import { EXPERIENCE_LEVEL_VALUES, type ExperienceLevel } from '@/domain/types/profile';

import type { profiles } from '../schema/profiles';

type ProfileRow = typeof profiles.$inferSelect;

const EXPERIENCE_LEVELS = new Set<string>(EXPERIENCE_LEVEL_VALUES);
const GOALS = new Set<string>(PROGRAM_GOAL_VALUES);
const EQUIPMENT = new Set<string>(EQUIPMENT_VALUES);
const CONSIDERATIONS = new Set<string>(PHYSICAL_CONSIDERATION_VALUES);

function parseExperienceLevel(value: string): ExperienceLevel {
  if (!EXPERIENCE_LEVELS.has(value)) {
    throw new Error(`Corrupt profile data: unknown experience level "${value}"`);
  }
  // Safe: membership was validated against the authoritative enum value list.
  return value as ExperienceLevel;
}

function parseGoal(value: string): ProgramGoal {
  if (!GOALS.has(value)) {
    throw new Error(`Corrupt profile data: unknown primary goal "${value}"`);
  }
  // Safe: membership was validated against the authoritative enum value list.
  return value as ProgramGoal;
}

function parseEquipment(value: string): EquipmentType {
  if (!EQUIPMENT.has(value)) {
    throw new Error(`Corrupt profile data: unknown equipment "${value}"`);
  }
  // Safe: membership was validated against the authoritative enum value list.
  return value as EquipmentType;
}

function parseConsideration(value: string): PhysicalConsideration {
  if (!CONSIDERATIONS.has(value)) {
    throw new Error(`Corrupt profile data: unknown physical consideration "${value}"`);
  }
  // Safe: membership was validated against the authoritative enum value list.
  return value as PhysicalConsideration;
}

/**
 * Reconstructs a domain UserProfile from a persisted row. Throws when the row
 * cannot satisfy the domain factory invariants — the database is trusted
 * structurally, so a violating row indicates corruption and must fail loudly.
 */
export function mapRowToUserProfile(row: ProfileRow): UserProfile {
  const result = createUserProfile({
    userId: row.userId,
    birthYear: row.birthYear,
    experienceLevel: parseExperienceLevel(row.experienceLevel),
    primaryGoal: parseGoal(row.primaryGoal),
    availableEquipment: row.availableEquipment.map(parseEquipment),
    physicalConsiderations: row.physicalConsiderations.map(parseConsideration),
    preferredDaysPerWeek: row.preferredDaysPerWeek,
    preferredSessionMinutes: row.preferredSessionMinutes,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  if (!result.ok) {
    throw new Error(`Corrupt data in profiles row "${row.userId}": ${result.error.message}`);
  }

  return result.data;
}

/**
 * Maps a domain UserProfile to its persistable row shape. Timestamps are
 * written from the entity (not DB-side defaults) so the domain controls time.
 */
export function mapUserProfileToRow(profile: UserProfile): typeof profiles.$inferInsert {
  return {
    userId: profile.userId,
    birthYear: profile.birthYear,
    experienceLevel: profile.experienceLevel,
    primaryGoal: profile.primaryGoal,
    availableEquipment: [...profile.availableEquipment],
    physicalConsiderations: [...profile.physicalConsiderations],
    preferredDaysPerWeek: profile.preferredDaysPerWeek,
    preferredSessionMinutes: profile.preferredSessionMinutes,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
