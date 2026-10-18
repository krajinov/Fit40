// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ExerciseDetailDto } from '@/application/dto/exercise';
import { ExerciseDetail } from '@/features/exercises/components/ExerciseDetail';

const exercise: ExerciseDetailDto = {
  id: 'ex-002', name: 'Goblet Squat', slug: 'goblet-squat', description: 'A squat holding a weight.',
  primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes'], equipment: 'dumbbell',
  difficulty: 'beginner', movementPattern: 'squat', considerations: [],
};

function render(personalHistoryHref?: string) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(createElement(ExerciseDetail, { exercise, personalHistoryHref }));
  return container;
}

describe('ExerciseDetail contextual personal history link', () => {
  it('renders exactly one accessible link when supplied', () => {
    const view = render('/history/exercises/goblet-squat');
    const links = view.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/history/exercises/goblet-squat');
    expect(links[0]?.textContent).toBe('View your history for this exercise');
  });

  it.each(['absent', 'unavailable'])('has no link for %s (no supplied href)', () => {
    const view = render();
    expect(view.querySelectorAll('a')).toHaveLength(0);
  });

  it.each([undefined, '/history/exercises/goblet-squat'])('preserves public detail content with href %j', (href) => {
    const view = render(href);
    expect(view.querySelector('h1')?.textContent).toBe(exercise.name);
    for (const text of [exercise.description, 'Muscles worked', 'Quadriceps', 'Glutes', 'At a glance', 'Dumbbell', 'Beginner', 'Squat']) {
      expect(view.textContent).toContain(text);
    }
  });
});
