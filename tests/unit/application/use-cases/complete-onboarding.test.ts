import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProfileAlreadyExistsError,
  type UserProfileRepository,
} from '@/application/ports/user-profile-repository';
import {
  CompleteOnboardingUseCase,
  type CompleteOnboardingInput,
} from '@/application/use-cases/complete-onboarding';
import { createUserProfile, type UserProfile } from '@/domain/entities/user-profile';
import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function validInput(): CompleteOnboardingInput {
  return {
    userId: USER_ID,
    birthYear: 1978,
    experienceLevel: ExperienceLevel.Beginner,
    primaryGoal: ProgramGoal.Strength,
    availableEquipment: [EquipmentType.Bodyweight, EquipmentType.Dumbbell],
    physicalConsiderations: [PhysicalConsideration.KneeSensitive],
    preferredDaysPerWeek: 3,
    preferredSessionMinutes: 60,
    heightCm: 178,
    weightKg: 82.5,
  };
}

function existingProfile(): UserProfile {
  const result = createUserProfile({
    ...validInput(),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  if (!result.ok) throw new Error('unexpected createUserProfile failure');
  return result.data;
}

describe('CompleteOnboardingUseCase', () => {
  const profileRepository: UserProfileRepository = {
    findByUserId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  let useCase: CompleteOnboardingUseCase;

  beforeEach(() => {
    vi.resetAllMocks();
    useCase = new CompleteOnboardingUseCase(profileRepository);
  });

  it('creates the profile and returns its DTO', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(profileRepository.create).mockResolvedValue(undefined);

    const result = await useCase.execute(validInput());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected failure');

    expect(result.data.userId).toBe(USER_ID);
    expect(result.data.birthYear).toBe(1978);
    expect(result.data.experienceLevel).toBe(ExperienceLevel.Beginner);
    expect(result.data.primaryGoal).toBe(ProgramGoal.Strength);
    expect(result.data.availableEquipment).toEqual([
      EquipmentType.Bodyweight,
      EquipmentType.Dumbbell,
    ]);
    expect(result.data.heightCm).toBe(178);
    expect(result.data.weightKg).toBe(82.5);

    const persisted = vi.mocked(profileRepository.create).mock.calls[0]?.[0];
    expect(persisted?.userId).toBe(USER_ID);
    expect(persisted?.createdAt.getTime()).toBe(persisted?.updatedAt.getTime());
  });

  it('passes the session-derived userId straight through to the repository', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(profileRepository.create).mockResolvedValue(undefined);

    await useCase.execute(validInput());

    expect(profileRepository.findByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('returns PROFILE_ALREADY_EXISTS when a profile already exists (preflight)', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(existingProfile());

    const result = await useCase.execute(validInput());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('PROFILE_ALREADY_EXISTS');
    expect(profileRepository.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique-constraint race to PROFILE_ALREADY_EXISTS', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(profileRepository.create).mockRejectedValue(
      new ProfileAlreadyExistsError(USER_ID),
    );

    const result = await useCase.execute(validInput());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('PROFILE_ALREADY_EXISTS');
  });

  it('returns INVALID_PROFILE when a domain invariant is violated', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);

    const result = await useCase.execute({ ...validInput(), preferredDaysPerWeek: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_PROFILE');
    if (result.error.code !== 'INVALID_PROFILE') throw new Error('unexpected error shape');
    expect(result.error.field).toBe('preferredDaysPerWeek');
    expect(profileRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a blank userId without touching the repository', async () => {
    const result = await useCase.execute({ ...validInput(), userId: '  ' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected success');

    expect(result.error.code).toBe('INVALID_PROFILE');
    expect(profileRepository.findByUserId).not.toHaveBeenCalled();
    expect(profileRepository.create).not.toHaveBeenCalled();
  });

  it('rethrows unexpected repository failures', async () => {
    vi.mocked(profileRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(profileRepository.create).mockRejectedValue(new Error('connection lost'));

    await expect(useCase.execute(validInput())).rejects.toThrow('connection lost');
  });
});
