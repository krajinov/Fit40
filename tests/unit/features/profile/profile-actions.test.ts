import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserProfileDto } from '@/application/dto/user-profile';

const { redirectMock, requireUserMock } = vi.hoisted(() => {
  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });

  return { redirectMock: redirect, requireUserMock: vi.fn() };
});

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/features/profile/services', () => ({
  completeOnboardingUseCase: { execute: vi.fn() },
  updateUserProfileUseCase: { execute: vi.fn() },
  getUserProfileUseCase: { execute: vi.fn() },
}));

import { revalidatePath } from 'next/cache';

import { completeOnboardingAction } from '@/features/profile/actions/complete-onboarding';
import { updateProfileAction } from '@/features/profile/actions/update-profile';
import {
  completeOnboardingUseCase,
  updateUserProfileUseCase,
} from '@/features/profile/services';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROFILE_DTO: UserProfileDto = {
  userId: SESSION_USER.id,
  birthYear: 1978,
  experienceLevel: 'beginner',
  primaryGoal: 'strength',
  availableEquipment: ['bodyweight'],
  physicalConsiderations: [],
  preferredDaysPerWeek: 3,
  preferredSessionMinutes: 60,
  heightCm: null,
  weightKg: 82.5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeValidFormData(): FormData {
  const fd = new FormData();
  fd.set('birthYear', '1978');
  fd.set('experienceLevel', 'beginner');
  fd.set('primaryGoal', 'strength');
  fd.append('availableEquipment', 'bodyweight');
  fd.set('preferredDaysPerWeek', '3');
  fd.set('preferredSessionMinutes', '60');
  fd.set('heightCm', '');
  fd.set('weightValue', '82.5');
  fd.set('weightUnit', 'kg');
  return fd;
}

describe('completeOnboardingAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('redirects unauthenticated users to login without touching the use case', async () => {
    requireUserMock.mockImplementation(() => redirectMock('/login?next=%2Fonboarding'));

    await expect(completeOnboardingAction(makeValidFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(completeOnboardingUseCase.execute).not.toHaveBeenCalled();
  });

  it('derives the userId from the session, never from form data', async () => {
    vi.mocked(completeOnboardingUseCase.execute).mockResolvedValue({
      ok: true,
      data: PROFILE_DTO,
    });

    const fd = makeValidFormData();
    fd.set('userId', 'attacker-supplied-id');

    await expect(completeOnboardingAction(fd)).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(completeOnboardingUseCase.execute).toHaveBeenCalledTimes(1);
    const input = vi.mocked(completeOnboardingUseCase.execute).mock.calls[0]?.[0];
    expect(input?.userId).toBe(SESSION_USER.id);
  });

  it('redirects to the dashboard after successful onboarding', async () => {
    vi.mocked(completeOnboardingUseCase.execute).mockResolvedValue({
      ok: true,
      data: PROFILE_DTO,
    });

    await expect(completeOnboardingAction(makeValidFormData())).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard',
    );
  });

  it('returns typed validation errors without calling the use case', async () => {
    const state = await completeOnboardingAction(new FormData());

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.error.code).toBe('VALIDATION_ERROR');
    expect(state.error.fieldErrors).toBeDefined();
    expect(Object.keys(state.error.fieldErrors ?? {}).length).toBeGreaterThan(0);
    expect(completeOnboardingUseCase.execute).not.toHaveBeenCalled();
  });

  it('preserves submitted values on validation errors', async () => {
    const fd = makeValidFormData();
    fd.set('birthYear', 'abcd');

    const state = await completeOnboardingAction(fd);

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.values?.birthYear).toBe('abcd');
    expect(state.values?.primaryGoal).toBe('strength');
    expect(state.values?.availableEquipment).toEqual(['bodyweight']);
  });

  it('passes through PROFILE_ALREADY_EXISTS from the use case', async () => {
    vi.mocked(completeOnboardingUseCase.execute).mockResolvedValue({
      ok: false,
      error: { code: 'PROFILE_ALREADY_EXISTS', message: 'Already onboarded.' },
    });

    const state = await completeOnboardingAction(makeValidFormData());

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.error.code).toBe('PROFILE_ALREADY_EXISTS');
  });

  it('maps INVALID_PROFILE factory errors into field errors', async () => {
    vi.mocked(completeOnboardingUseCase.execute).mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_PROFILE',
        message: 'preferredDaysPerWeek out of range',
        field: 'preferredDaysPerWeek',
      },
    });

    const state = await completeOnboardingAction(makeValidFormData());

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.error.fieldErrors?.preferredDaysPerWeek).toEqual([
      'preferredDaysPerWeek out of range',
    ]);
  });
});

describe('updateProfileAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('redirects unauthenticated users to login without touching the use case', async () => {
    requireUserMock.mockImplementation(() => redirectMock('/login?next=%2Fprofile'));

    await expect(updateProfileAction(makeValidFormData())).rejects.toThrow('NEXT_REDIRECT');

    expect(updateUserProfileUseCase.execute).not.toHaveBeenCalled();
  });

  it('derives the userId from the session, never from form data', async () => {
    vi.mocked(updateUserProfileUseCase.execute).mockResolvedValue({
      ok: true,
      data: PROFILE_DTO,
    });

    const fd = makeValidFormData();
    fd.set('userId', 'attacker-supplied-id');

    const state = await updateProfileAction(fd);

    expect(state.ok).toBe(true);
    const input = vi.mocked(updateUserProfileUseCase.execute).mock.calls[0]?.[0];
    expect(input?.userId).toBe(SESSION_USER.id);
  });

  it('returns ok+saved and revalidates the profile route on success', async () => {
    vi.mocked(updateUserProfileUseCase.execute).mockResolvedValue({
      ok: true,
      data: PROFILE_DTO,
    });

    const state = await updateProfileAction(makeValidFormData());

    expect(state).toEqual({ ok: true, saved: true });
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('returns typed validation errors without calling the use case', async () => {
    const state = await updateProfileAction(new FormData());

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.error.code).toBe('VALIDATION_ERROR');
    expect(updateUserProfileUseCase.execute).not.toHaveBeenCalled();
  });

  it('passes through PROFILE_NOT_FOUND from the use case', async () => {
    vi.mocked(updateUserProfileUseCase.execute).mockResolvedValue({
      ok: false,
      error: { code: 'PROFILE_NOT_FOUND', message: 'No profile found.' },
    });

    const state = await updateProfileAction(makeValidFormData());

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error('unexpected success');

    expect(state.error.code).toBe('PROFILE_NOT_FOUND');
  });
});
