import { describe, expect, it } from 'vitest';

import { EquipmentType, PhysicalConsideration } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { ExperienceLevel } from '@/domain/types/profile';
import {
  parseProfileFormData,
  profileFormSchema,
  toProfileFormOutput,
} from '@/features/profile/schemas/profile-schemas';

function makeFormData(overrides: Record<string, string | string[]> = {}): FormData {
  const fd = new FormData();
  fd.set('birthYear', '1978');
  fd.set('experienceLevel', 'beginner');
  fd.set('primaryGoal', 'strength');
  fd.append('availableEquipment', 'bodyweight');
  fd.append('availableEquipment', 'dumbbell');
  fd.append('physicalConsiderations', 'knee-sensitive');
  fd.set('preferredDaysPerWeek', '3');
  fd.set('preferredSessionMinutes', '60');
  fd.set('heightCm', '178');
  fd.set('weightValue', '82.5');
  fd.set('weightUnit', 'kg');

  for (const [key, value] of Object.entries(overrides)) {
    fd.delete(key);
    if (Array.isArray(value)) {
      for (const entry of value) {
        fd.append(key, entry);
      }
    } else {
      fd.set(key, value);
    }
  }

  return fd;
}

describe('profileFormSchema', () => {
  it('parses a complete valid submission', () => {
    const parsed = profileFormSchema.safeParse(parseProfileFormData(makeFormData()));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const output = toProfileFormOutput(parsed.data);
    expect(output.birthYear).toBe(1978);
    expect(output.experienceLevel).toBe(ExperienceLevel.Beginner);
    expect(output.primaryGoal).toBe(ProgramGoal.Strength);
    expect(output.availableEquipment).toEqual([
      EquipmentType.Bodyweight,
      EquipmentType.Dumbbell,
    ]);
    expect(output.physicalConsiderations).toEqual([PhysicalConsideration.KneeSensitive]);
    expect(output.preferredDaysPerWeek).toBe(3);
    expect(output.preferredSessionMinutes).toBe(60);
    expect(output.heightCm).toBe(178);
    expect(output.weightKg).toBe(82.5);
  });

  it('treats an empty height as null', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ heightCm: '  ' })),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(toProfileFormOutput(parsed.data).heightCm).toBeNull();
  });

  it('converts pounds to canonical kilograms rounded to one decimal', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ weightValue: '176', weightUnit: 'lb' })),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(toProfileFormOutput(parsed.data).weightKg).toBe(79.8);
  });

  it('rejects a non-numeric birth year', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ birthYear: 'abcd' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'birthYear')).toBe(true);
  });

  it('rejects a minor', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ birthYear: '2015' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const issue = parsed.error.issues.find((entry) => entry.path[0] === 'birthYear');
    expect(issue?.message).toContain('at least 18');
  });

  it('rejects an implausibly old birth year', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ birthYear: '1900' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'birthYear')).toBe(true);
  });

  it('rejects a missing goal', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ primaryGoal: '' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'primaryGoal')).toBe(true);
  });

  it('rejects an unknown experience level', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ experienceLevel: 'elite' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'experienceLevel')).toBe(true);
  });

  it('rejects an empty equipment selection', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ availableEquipment: [] })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'availableEquipment')).toBe(true);
  });

  it('dedupes duplicate equipment submissions', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ availableEquipment: ['dumbbell', 'dumbbell'] })),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(toProfileFormOutput(parsed.data).availableEquipment).toEqual([
      EquipmentType.Dumbbell,
    ]);
  });

  it('rejects unknown equipment values', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ availableEquipment: ['treadmill'] })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'availableEquipment')).toBe(true);
  });

  it('allows empty physical considerations and dedupes duplicates', () => {
    const empty = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ physicalConsiderations: [] })),
    );
    expect(empty.success).toBe(true);

    const duplicated = profileFormSchema.safeParse(
      parseProfileFormData(
        makeFormData({ physicalConsiderations: ['knee-sensitive', 'knee-sensitive'] }),
      ),
    );
    expect(duplicated.success).toBe(true);
    if (!duplicated.success) return;

    expect(toProfileFormOutput(duplicated.data).physicalConsiderations).toEqual([
      PhysicalConsideration.KneeSensitive,
    ]);
  });

  it.each(['0', '8', '3.5'])('rejects preferredDaysPerWeek of %s', (value) => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ preferredDaysPerWeek: value })),
    );

    expect(parsed.success).toBe(false);
  });

  it.each(['9', '241', ''])('rejects preferredSessionMinutes of %s', (value) => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ preferredSessionMinutes: value })),
    );

    expect(parsed.success).toBe(false);
  });

  it.each(['99', '251', '178.5', 'abc'])('rejects heightCm of %s', (value) => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ heightCm: value })),
    );

    expect(parsed.success).toBe(false);
  });

  it.each(['', '0', '-5'])('rejects weightValue of %s', (value) => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ weightValue: value })),
    );

    expect(parsed.success).toBe(false);
  });

  it('rejects a weight below the canonical kg range even in pounds', () => {
    // 20 lb converts to ~9.1 kg, below the 30 kg minimum.
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ weightValue: '20', weightUnit: 'lb' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'weight')).toBe(true);
  });

  it('rejects an unknown weight unit', () => {
    const parsed = profileFormSchema.safeParse(
      parseProfileFormData(makeFormData({ weightUnit: 'stone' })),
    );

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.some((issue) => issue.path[0] === 'weight')).toBe(true);
  });
});
