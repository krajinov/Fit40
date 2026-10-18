// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { exerciseExecute, presenceExecute, currentUser, notFound } = vi.hoisted(() => ({
  exerciseExecute: vi.fn(), presenceExecute: vi.fn(), currentUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: currentUser }));
vi.mock('@/features/exercises/services', () => ({
  getExerciseBySlugUseCase: { execute: exerciseExecute },
  getExerciseHistoryPresenceUseCase: { execute: presenceExecute },
}));
vi.mock('@/infrastructure/database/repositories', () => {
  throw new Error('Page must use feature composition');
});

import ExerciseDetailPage, { generateMetadata } from '@/app/(app)/exercises/[slug]/page';

const exercise = {
  id: 'ex-002', name: 'Goblet Squat', slug: 'goblet-squat', description: 'A squat holding a weight.',
  primaryMuscle: 'quadriceps', secondaryMuscles: [], equipment: 'dumbbell',
  difficulty: 'beginner', movementPattern: 'squat', considerations: [],
};
const props = { params: Promise.resolve({ slug: exercise.slug }) };

async function render() {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(await ExerciseDetailPage(props));
  return container;
}

beforeEach(() => {
  vi.resetAllMocks();
  exerciseExecute.mockResolvedValue({ ok: true, data: exercise });
  presenceExecute.mockResolvedValue({ ok: true, data: { status: 'absent' } });
  currentUser.mockResolvedValue({ id: 'trusted-user' });
});
afterEach(() => vi.restoreAllMocks());

describe('public exercise detail page', () => {
  it('never reads personal history for signed-out visitors', async () => {
    currentUser.mockResolvedValue(null);
    const view = await render();
    expect(presenceExecute).not.toHaveBeenCalled();
    expect(view.querySelectorAll('a[href^="/history/exercises/"]')).toHaveLength(0);
    expect(view.querySelector('h1')?.textContent).toBe(exercise.name);
  });

  it.each(['present', 'absent', 'unavailable'])('shows a link only for authenticated present history: %s', async (status) => {
    presenceExecute.mockResolvedValue({ ok: true, data: { status, cause: new Error('read failed') } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await render();
    expect(presenceExecute).toHaveBeenCalledExactlyOnceWith({ userId: 'trusted-user', slug: exercise.slug });
    expect(view.querySelectorAll('a[href="/history/exercises/goblet-squat"]')).toHaveLength(status === 'present' ? 1 : 0);
    expect(view.querySelector('h1')?.textContent).toBe(exercise.name);
    expect(view.textContent).toContain(exercise.description);
    expect(view.textContent).not.toContain('read failed');
  });

  it('keeps unknown exercises as pre-render 404s without auth/history reads', async () => {
    exerciseExecute.mockResolvedValue({ ok: false, error: { code: 'EXERCISE_NOT_FOUND' } });
    await expect(ExerciseDetailPage(props)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
    expect(currentUser).not.toHaveBeenCalled();
    expect(presenceExecute).not.toHaveBeenCalled();
  });

  it('keeps malformed slugs as 404s without repository reads', async () => {
    await expect(ExerciseDetailPage({ params: Promise.resolve({ slug: 'INVALID SLUG' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(exerciseExecute).not.toHaveBeenCalled();
    expect(presenceExecute).not.toHaveBeenCalled();
  });

  it('does not catch authentication navigation sentinels', async () => {
    const sentinel = new Error('NEXT_REDIRECT');
    currentUser.mockRejectedValue(sentinel);
    await expect(ExerciseDetailPage(props)).rejects.toBe(sentinel);
    expect(presenceExecute).not.toHaveBeenCalled();
  });

  it('keeps metadata public and free of personal history reads', async () => {
    expect(await generateMetadata(props)).toEqual({ title: exercise.name });
    expect(currentUser).not.toHaveBeenCalled();
    expect(presenceExecute).not.toHaveBeenCalled();
  });
});
