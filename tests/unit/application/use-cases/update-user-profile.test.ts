import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfileRepository } from '@/application/ports/user-profile-repository';
import {
  UpdateUserProfileUseCase,
  type UpdateUserProfileInput,
} from '@/application/use-cases/update-user-profile';
import { createUserProfile, type UserProfile } from '@/domain/entities/user-profile';
import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGINAL_CREATED_AT = new Date('2026-01-01T00:00:00Z');

function existingProfile(): UserProfile {
  const result = createUserProfile({
    userId: USER_ID,
    birthYear: 1978,
    experienceLevel: ExperienceLevel.Beginner,
    primaryGoal: ProgramGoal.Strength,
    availableEquipment: [EquipmentType.Bodyweight],
    physicalConsiderations: [],
    preferredDaysPerWeek: 2,
    preferredSessionMinutes: 30,
    heightCm: null,
    weightKg: 90,
    createdAt: ORIGINAL_CREATED_AT,
    updatedAt: ORIGINAL_CREATED_AT,
  });
  if (!result.ok) throw new Error('unexpected createUserProfile failure');
  return result.data;
}

function validUpdate(): UpdateUserProfileInput {
  return {
    userId: USER_ID,
    birthYear: 1978,
    experienceLevel: ExperienceLevel.Intermediate,
    primaryGoal: ProgramGoal.Mobility,
    availableEquipment: [EquipmentType.Barbell, EquipmentType.Bench],
    physicalConsiderations: [PhysicalConsideration.LowerBackSensitive],
    preferredDaysPerWeek: 4,
    preferredSessionMinutes: 45,
    heightCm: 180,
    weightKg: 88,
  };
}

describe('UpdateUserProfileUseCase', () => {
  const profileRepository: UserProfileRepository = {
    findByUserId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  let useCase: UpdateUserProfileUseCase;

  beforeEach(() => {
    vi.resetAllMocks();
    useCase = new UpdateUserProfileUseCase(profileRepository);
  });

  it('updates the profile, preserving identity and createdAt', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(existingProfile());
    vi.mocked(profileRepository.update).mockResolvedValue(true);

    const result = await useCase.execute(validUpdate());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');

    expect(result.data.userId).toBe(USER_ID);
    expect(result.data.experienceLevel).toBe(ExperienceLevel.Intermediate);
    expect(result.data.primaryGoal).toBe(ProgramGoal.Mobility);
    expect(result.data.availableEquipment).toEqual([
      EquipmentType.Barbell,
      EquipmentType.Bench,
    ]);
    expect(result.data.physicalConsiderations).toEqual([
      PhysicalConsideration.LowerBackSensitive,
    ]);
    expect(result.data.preferredDaysPerWeek).toBe(4);
    expect(result.data.preferredSessionMinutes).toBe(45);
    expect(result.data.heightCm).toBe(180);
    expect(result.data.weightKg).toBe(88);
    expect(result.data.createdAt).toBe(ORIGINAL_CREATED_AT.toISOString());
    expect(new Date(result.data.updatedAt).getTime()).toBeGreaterThanOrEqual(
      ORIGINAL_CREATED_AT.getTime(),
    );

    const persisted = vi.mocked(profileRepository.update).mock.calls[0]?.[0];
    expect(persisted?.userId).toBe(USER_ID);
    expect(persisted?.createdAt.getTime()).toBe(ORIGINAL_CREATED_AT.getTime());
    expect(profileRepository.create).not.toHaveBeenCalled();
  });

  it('returns PROFILE_NOT_FOUND when no profile exists', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);

    const result = await useCase.execute(validUpdate());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('PROFILE_NOT_FOUND');
    expect(profileRepository.update).not.toHaveBeenCalled();
    expect(profileRepository.create).not.toHaveBeenCalled();
  });

  it('returns PROFILE_NOT_FOUND when the update matches no row (concurrent deletion)', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(existingProfile());
    vi.mocked(profileRepository.update).mockResolvedValue(false);

    const result = await useCase.execute(validUpdate());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('PROFILE_NOT_FOUND');
  });

  it('returns INVALID_PROFILE when a domain invariant is violated', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(existingProfile());

    const result = await useCase.execute({ ...validUpdate(), weightKg: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_PROFILE');
    if (result.error.code !== 'INVALID_PROFILE') throw new Error('unexpected error shape');
    expect(result.error.field).toBe('weightKg');
    expect(profileRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a blank userId without touching the repository', async () => {
    const result = await useCase.execute({ ...validUpdate(), userId: '  ' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_PROFILE');
    expect(profileRepository.findByUserId).not.toHaveBeenCalled();
  });

  it('rethrows unexpected repository failures', async () => {
    vi.mocked(profileRepository.findByUserId).mockRejectedValue(new Error('connection lost'));

    await expect(useCase.execute(validUpdate())).rejects.toThrow('connection lost');
  });
});
