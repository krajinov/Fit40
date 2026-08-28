/**
 * Data transfer objects for user fitness profiles crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes: branded IDs are stripped to plain
 * strings, Dates are serialized to ISO 8601 strings.
 */

import type { UserProfile } from '@/domain/entities/user-profile';
import type { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import type { ProgramGoal } from '@/domain/types/program';
import type { ExperienceLevel } from '@/domain/types/profile';

export interface UserProfileDto {
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
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toUserProfileDto(profile: UserProfile): UserProfileDto {
  return {
    userId: profile.userId,
    birthYear: profile.birthYear,
    experienceLevel: profile.experienceLevel,
    primaryGoal: profile.primaryGoal,
    availableEquipment: profile.availableEquipment,
    physicalConsiderations: profile.physicalConsiderations,
    preferredDaysPerWeek: profile.preferredDaysPerWeek,
    preferredSessionMinutes: profile.preferredSessionMinutes,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
