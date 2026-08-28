import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfileRepository } from '@/application/ports/user-profile-repository';
import { GetUserProfileUseCase } from '@/application/use-cases/get-user-profile';
import { createUserProfile, type UserProfile } from '@/domain/entities/user-profile';
import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function existingProfile(): UserProfile {
  const result = createUserProfile({
    userId: USER_ID,
    birthYear: 1978,
    experienceLevel: ExperienceLevel.Beginner,
    primaryGoal: ProgramGoal.GeneralFitness,
    availableEquipment: [EquipmentType.Bodyweight],
    physicalConsiderations: [PhysicalConsideration.LimitedMobility],
    preferredDaysPerWeek: 2,
    preferredSessionMinutes: 30,
    heightCm: null,
    weightKg: 75,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  });
  if (!result.ok) throw new Error('unexpected createUserProfile failure');
  return result.data;
}

describe('GetUserProfileUseCase', () => {
  const profileRepository: UserProfileRepository = {
    findByUserId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  let useCase: GetUserProfileUseCase;

  beforeEach(() => {
    vi.resetAllMocks();
    useCase = new GetUserProfileUseCase(profileRepository);
  });

  it('returns the profile DTO when the user has completed onboarding', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(existingProfile());

    const result = await useCase.execute(USER_ID);

    expect(result).not.toBeNull();
    if (result === null) throw new Error('unexpected null');

    expect(result.userId).toBe(USER_ID);
    expect(result.birthYear).toBe(1978);
    expect(result.primaryGoal).toBe(ProgramGoal.GeneralFitness);
    expect(result.availableEquipment).toEqual([EquipmentType.Bodyweight]);
    expect(result.physicalConsiderations).toEqual([PhysicalConsideration.LimitedMobility]);
    expect(result.heightCm).toBeNull();
    expect(result.weightKg).toBe(75);
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns null when the user has no profile yet', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);

    const result = await useCase.execute(USER_ID);

    expect(result).toBeNull();
  });

  it('returns null for an invalid userId without querying the repository', async () => {
    const result = await useCase.execute('   ');

    expect(result).toBeNull();
    expect(profileRepository.findByUserId).not.toHaveBeenCalled();
  });
});
