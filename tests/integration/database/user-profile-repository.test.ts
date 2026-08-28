import { beforeEach, describe, expect, it } from 'vitest';

import { ProfileAlreadyExistsError } from '@/application/ports/user-profile-repository';
import { createUserProfile } from '@/domain/entities/user-profile';
import { createUser } from '@/domain/entities/user';
import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';
import { DrizzleUserProfileRepository } from '@/infrastructure/database/repositories/drizzle-user-profile-repository';

import { db, resetDatabase, userRepository } from './setup';
import { profiles, users } from '@/infrastructure/database/schema';
import { eq } from 'drizzle-orm';

const repository = new DrizzleUserProfileRepository(db);

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const CREATED_AT = new Date('2026-01-01T00:00:00Z');
const UPDATED_AT = new Date('2026-02-01T00:00:00Z');

async function createTestUser(id: string): Promise<void> {
  const userResult = createUser({
    id,
    email: `${id}@example.com`,
    createdAt: CREATED_AT,
  });

  expect(userResult.ok).toBe(true);
  if (!userResult.ok) throw new Error('unexpected createUser failure');

  await userRepository.create(userResult.data, 'hashed-password');
}

function validProfileInput(overrides?: Partial<Parameters<typeof createUserProfile>[0]>) {
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
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function validProfile(overrides?: Partial<Parameters<typeof createUserProfile>[0]>) {
  const result = createUserProfile(validProfileInput(overrides));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unexpected createUserProfile failure');
  return result.data;
}

describe('DrizzleUserProfileRepository', () => {
  beforeEach(async () => {
    await resetDatabase();
    await createTestUser(USER_ID);
    await createTestUser(OTHER_USER_ID);
  });

  it('creates a profile and finds it by user id with a full round-trip', async () => {
    await repository.create(validProfile());

    const found = await repository.findByUserId(validProfile().userId);

    expect(found).not.toBeNull();
    expect(found?.userId).toBe(USER_ID);
    expect(found?.birthYear).toBe(1978);
    expect(found?.experienceLevel).toBe(ExperienceLevel.Beginner);
    expect(found?.primaryGoal).toBe(ProgramGoal.Strength);
    expect(found?.availableEquipment).toEqual([
      EquipmentType.Bodyweight,
      EquipmentType.Dumbbell,
    ]);
    expect(found?.physicalConsiderations).toEqual([PhysicalConsideration.KneeSensitive]);
    expect(found?.preferredDaysPerWeek).toBe(3);
    expect(found?.preferredSessionMinutes).toBe(60);
    expect(found?.heightCm).toBe(178);
    expect(found?.weightKg).toBe(82.5);
    expect(found?.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    expect(found?.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString());
  });

  it('round-trips empty physical considerations, omitted height, and a second user independently', async () => {
    await repository.create(
      validProfile({ physicalConsiderations: [], heightCm: null, weightKg: 60 }),
    );
    await repository.create(
      validProfile({
        userId: OTHER_USER_ID,
        birthYear: 1985,
        primaryGoal: ProgramGoal.WeightLoss,
        availableEquipment: [EquipmentType.ResistanceBand],
        physicalConsiderations: [
          PhysicalConsideration.LowerBackSensitive,
          PhysicalConsideration.LimitedMobility,
        ],
        preferredDaysPerWeek: 2,
        preferredSessionMinutes: 30,
        heightCm: 165,
        weightKg: 97.75,
      }),
    );

    const first = await repository.findByUserId(validProfile().userId);
    expect(first?.physicalConsiderations).toEqual([]);
    expect(first?.heightCm).toBeNull();
    expect(first?.weightKg).toBe(60);

    const second = await repository.findByUserId(
      validProfile({ userId: OTHER_USER_ID }).userId,
    );
    expect(second?.birthYear).toBe(1985);
    expect(second?.primaryGoal).toBe(ProgramGoal.WeightLoss);
    expect(second?.availableEquipment).toEqual([EquipmentType.ResistanceBand]);
    expect(second?.physicalConsiderations).toEqual([
      PhysicalConsideration.LowerBackSensitive,
      PhysicalConsideration.LimitedMobility,
    ]);
    expect(second?.weightKg).toBe(97.75);
  });

  it('returns null for a user without a profile', async () => {
    const found = await repository.findByUserId(validProfile().userId);

    expect(found).toBeNull();
  });

  it('rejects a second profile for the same user with ProfileAlreadyExistsError', async () => {
    await repository.create(validProfile());

    await expect(
      repository.create(validProfile({ primaryGoal: ProgramGoal.Mobility })),
    ).rejects.toBeInstanceOf(ProfileAlreadyExistsError);

    const found = await repository.findByUserId(validProfile().userId);
    expect(found?.primaryGoal).toBe(ProgramGoal.Strength);
  });

  it('updates an existing profile, preserving createdAt', async () => {
    await repository.create(validProfile());

    const later = new Date('2026-03-15T10:30:00Z');
    const updated = validProfile({
      experienceLevel: ExperienceLevel.Advanced,
      primaryGoal: ProgramGoal.Hypertrophy,
      availableEquipment: [EquipmentType.Barbell],
      physicalConsiderations: [],
      preferredDaysPerWeek: 5,
      preferredSessionMinutes: 90,
      heightCm: null,
      weightKg: 79,
      updatedAt: later,
    });

    const matched = await repository.update(updated);

    expect(matched).toBe(true);

    const found = await repository.findByUserId(validProfile().userId);
    expect(found?.experienceLevel).toBe(ExperienceLevel.Advanced);
    expect(found?.primaryGoal).toBe(ProgramGoal.Hypertrophy);
    expect(found?.availableEquipment).toEqual([EquipmentType.Barbell]);
    expect(found?.physicalConsiderations).toEqual([]);
    expect(found?.preferredDaysPerWeek).toBe(5);
    expect(found?.preferredSessionMinutes).toBe(90);
    expect(found?.heightCm).toBeNull();
    expect(found?.weightKg).toBe(79);
    expect(found?.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    expect(found?.updatedAt.toISOString()).toBe(later.toISOString());
  });

  it('returns false when updating a user without a profile', async () => {
    const matched = await repository.update(validProfile({ userId: OTHER_USER_ID }));

    expect(matched).toBe(false);
  });

  it('cascades profile deletion when the auth user is deleted', async () => {
    await repository.create(validProfile());

    await db.delete(users).where(eq(users.id, USER_ID));

    const found = await repository.findByUserId(validProfile().userId);
    expect(found).toBeNull();

    const rows = await db.select().from(profiles).where(eq(profiles.userId, USER_ID));
    expect(rows).toEqual([]);
  });

  it('rejects out-of-enum equipment values at the database level', async () => {
    await expect(
      db.insert(profiles).values({
        userId: USER_ID,
        birthYear: 1978,
        experienceLevel: 'beginner',
        primaryGoal: 'strength',
        availableEquipment: ['treadmill'],
        physicalConsiderations: [],
        preferredDaysPerWeek: 3,
        preferredSessionMinutes: 60,
        heightCm: null,
        weightKg: 80,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      }),
    ).rejects.toThrow();
  });

  it('rejects an empty equipment array at the database level', async () => {
    await expect(
      db.insert(profiles).values({
        userId: USER_ID,
        birthYear: 1978,
        experienceLevel: 'beginner',
        primaryGoal: 'strength',
        availableEquipment: [],
        physicalConsiderations: [],
        preferredDaysPerWeek: 3,
        preferredSessionMinutes: 60,
        heightCm: null,
        weightKg: 80,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      }),
    ).rejects.toThrow();
  });

  it('rejects an absurd weight at the database level', async () => {
    await expect(
      db.insert(profiles).values({
        userId: USER_ID,
        birthYear: 1978,
        experienceLevel: 'beginner',
        primaryGoal: 'strength',
        availableEquipment: ['bodyweight'],
        physicalConsiderations: [],
        preferredDaysPerWeek: 3,
        preferredSessionMinutes: 60,
        heightCm: null,
        weightKg: 999,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      }),
    ).rejects.toThrow();
  });
});
