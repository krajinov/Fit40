import { describe, expect, it } from 'vitest';

import {
  applyProfileUpdate,
  approximateAgeInYears,
  createUserProfile,
  PROFILE_MAX_AGE,
  PROFILE_MIN_AGE,
} from '@/domain/entities/user-profile';
import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';

const NOW = new Date('2026-06-15T12:00:00Z');

function validInput() {
  return {
    userId: '11111111-1111-1111-1111-111111111111',
    birthYear: 1978,
    experienceLevel: ExperienceLevel.Beginner,
    primaryGoal: ProgramGoal.Strength,
    availableEquipment: [EquipmentType.Bodyweight, EquipmentType.Dumbbell] as const,
    physicalConsiderations: [PhysicalConsideration.KneeSensitive] as const,
    preferredDaysPerWeek: 3,
    preferredSessionMinutes: 60,
    heightCm: 178,
    weightKg: 82.5,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('createUserProfile', () => {
  it('creates a valid profile with all fields', () => {
    const result = createUserProfile(validInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.userId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.data.birthYear).toBe(1978);
    expect(result.data.experienceLevel).toBe(ExperienceLevel.Beginner);
    expect(result.data.primaryGoal).toBe(ProgramGoal.Strength);
    expect(result.data.availableEquipment).toEqual([
      EquipmentType.Bodyweight,
      EquipmentType.Dumbbell,
    ]);
    expect(result.data.physicalConsiderations).toEqual([PhysicalConsideration.KneeSensitive]);
    expect(result.data.preferredDaysPerWeek).toBe(3);
    expect(result.data.preferredSessionMinutes).toBe(60);
    expect(result.data.heightCm).toBe(178);
    expect(result.data.weightKg).toBe(82.5);
    expect(result.data.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(result.data.updatedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('allows empty physical considerations and omitted height', () => {
    const result = createUserProfile({
      ...validInput(),
      physicalConsiderations: [],
      heightCm: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.physicalConsiderations).toEqual([]);
    expect(result.data.heightCm).toBeNull();
  });

  it('rejects an empty userId', () => {
    const result = createUserProfile({ ...validInput(), userId: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('userId');
  });

  it('rejects a non-integer birth year', () => {
    const result = createUserProfile({ ...validInput(), birthYear: 1978.5 });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('birthYear');
  });

  it('rejects a birth year earlier than the sane lower bound', () => {
    const result = createUserProfile({ ...validInput(), birthYear: 1899 });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('birthYear');
  });

  it('accepts a user turning exactly the minimum age this year', () => {
    const result = createUserProfile({
      ...validInput(),
      birthYear: NOW.getUTCFullYear() - PROFILE_MIN_AGE,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a user younger than the minimum age', () => {
    const result = createUserProfile({
      ...validInput(),
      birthYear: NOW.getUTCFullYear() - PROFILE_MIN_AGE + 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('birthYear');
  });

  it('accepts a user turning exactly the maximum age this year', () => {
    const result = createUserProfile({
      ...validInput(),
      birthYear: NOW.getUTCFullYear() - PROFILE_MAX_AGE,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a birth year implying an age above the maximum', () => {
    const result = createUserProfile({
      ...validInput(),
      birthYear: NOW.getUTCFullYear() - PROFILE_MAX_AGE - 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('birthYear');
  });

  it('rejects an empty equipment list', () => {
    const result = createUserProfile({ ...validInput(), availableEquipment: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('availableEquipment');
  });

  it('rejects duplicate equipment entries', () => {
    const result = createUserProfile({
      ...validInput(),
      availableEquipment: [EquipmentType.Dumbbell, EquipmentType.Dumbbell],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('availableEquipment');
  });

  it('rejects unknown equipment values at runtime', () => {
    // Intentionally bypasses the type system: this runtime guard protects the
    // mapper path, where array contents arrive as plain strings from the DB.
    const bogus = ['treadmill'] as unknown as ReadonlyArray<EquipmentType>;

    const result = createUserProfile({ ...validInput(), availableEquipment: bogus });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('availableEquipment');
  });

  it('rejects duplicate physical considerations', () => {
    const result = createUserProfile({
      ...validInput(),
      physicalConsiderations: [
        PhysicalConsideration.KneeSensitive,
        PhysicalConsideration.KneeSensitive,
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('physicalConsiderations');
  });

  it('rejects unknown physical consideration values at runtime', () => {
    // Same mapper-path guard rationale as the equipment case above.
    const bogus = ['glass-jaw'] as unknown as ReadonlyArray<PhysicalConsideration>;

    const result = createUserProfile({ ...validInput(), physicalConsiderations: bogus });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('physicalConsiderations');
  });

  it.each([0, 8, 3.5])('rejects preferredDaysPerWeek of %s', (days) => {
    const result = createUserProfile({ ...validInput(), preferredDaysPerWeek: days });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('preferredDaysPerWeek');
  });

  it.each([9, 241, 45.5])('rejects preferredSessionMinutes of %s', (minutes) => {
    const result = createUserProfile({ ...validInput(), preferredSessionMinutes: minutes });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('preferredSessionMinutes');
  });

  it.each([99, 251, 178.5])('rejects heightCm of %s', (heightCm) => {
    const result = createUserProfile({ ...validInput(), heightCm });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('heightCm');
  });

  it.each([29, 401, Number.NaN, Number.POSITIVE_INFINITY])('rejects weightKg of %s', (weightKg) => {
    const result = createUserProfile({ ...validInput(), weightKg });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('weightKg');
  });

  it('rejects an invalid createdAt', () => {
    const result = createUserProfile({ ...validInput(), createdAt: new Date(NaN) });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('createdAt');
  });

  it('rejects an invalid updatedAt', () => {
    const result = createUserProfile({ ...validInput(), updatedAt: new Date(NaN) });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('updatedAt');
  });

  it('rejects updatedAt earlier than createdAt', () => {
    const result = createUserProfile({
      ...validInput(),
      createdAt: NOW,
      updatedAt: new Date('2026-06-14T12:00:00Z'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('updatedAt');
  });
});

describe('applyProfileUpdate', () => {
  function existingProfile() {
    const result = createUserProfile(validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected createUserProfile failure');
    return result.data;
  }

  it('applies changes, preserves identity and createdAt, and bumps updatedAt', () => {
    const profile = existingProfile();
    const later = new Date('2026-07-01T09:30:00Z');

    const result = applyProfileUpdate(
      profile,
      {
        birthYear: 1979,
        experienceLevel: ExperienceLevel.Intermediate,
        primaryGoal: ProgramGoal.Mobility,
        availableEquipment: [EquipmentType.Barbell],
        physicalConsiderations: [],
        preferredDaysPerWeek: 4,
        preferredSessionMinutes: 45,
        heightCm: null,
        weightKg: 80,
      },
      later,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.userId).toBe(profile.userId);
    expect(result.data.birthYear).toBe(1979);
    expect(result.data.experienceLevel).toBe(ExperienceLevel.Intermediate);
    expect(result.data.primaryGoal).toBe(ProgramGoal.Mobility);
    expect(result.data.availableEquipment).toEqual([EquipmentType.Barbell]);
    expect(result.data.physicalConsiderations).toEqual([]);
    expect(result.data.preferredDaysPerWeek).toBe(4);
    expect(result.data.preferredSessionMinutes).toBe(45);
    expect(result.data.heightCm).toBeNull();
    expect(result.data.weightKg).toBe(80);
    expect(result.data.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(result.data.updatedAt.toISOString()).toBe(later.toISOString());
  });

  it('re-validates the updated fields', () => {
    const profile = existingProfile();

    const result = applyProfileUpdate(
      profile,
      {
        birthYear: profile.birthYear,
        experienceLevel: profile.experienceLevel,
        primaryGoal: profile.primaryGoal,
        availableEquipment: [],
        physicalConsiderations: profile.physicalConsiderations,
        preferredDaysPerWeek: profile.preferredDaysPerWeek,
        preferredSessionMinutes: profile.preferredSessionMinutes,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
      },
      new Date('2026-07-01T09:30:00Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('availableEquipment');
  });

  it('rejects an update timestamp earlier than the original createdAt', () => {
    const profile = existingProfile();

    const result = applyProfileUpdate(
      profile,
      {
        birthYear: profile.birthYear,
        experienceLevel: profile.experienceLevel,
        primaryGoal: profile.primaryGoal,
        availableEquipment: profile.availableEquipment,
        physicalConsiderations: profile.physicalConsiderations,
        preferredDaysPerWeek: profile.preferredDaysPerWeek,
        preferredSessionMinutes: profile.preferredSessionMinutes,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
      },
      new Date('2026-06-14T12:00:00Z'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('updatedAt');
  });
});

describe('approximateAgeInYears', () => {
  it('derives the age turned in the reference calendar year', () => {
    expect(approximateAgeInYears(1978, new Date('2026-01-01T00:00:00Z'))).toBe(48);
    expect(approximateAgeInYears(1978, new Date('2026-12-31T23:59:59Z'))).toBe(48);
  });
});
