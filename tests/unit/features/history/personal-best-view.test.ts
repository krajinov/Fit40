/**
 * Unit tests for the Personal Bests presentation mapping (M12 Slice 3).
 *
 * The mapping is pure: the exact record the repository returned is formatted
 * for display, and nothing is re-ranked or re-selected — a later performance
 * that repeated the same maximum can never take over the link, because the
 * link is simply the record's own session id.
 */

import { describe, expect, it } from 'vitest';

import type { PersonalBestDto } from '@/application/dto/personal-records';

import {
  personalBestValueLabel,
  toPersonalBestView,
  toPersonalBestsView,
} from '@/features/history/personal-best-view';

function best(overrides?: Partial<PersonalBestDto>): PersonalBestDto {
  return {
    exerciseId: 'ex-001',
    metric: 'max-load',
    value: 82.5,
    sessionId: 'session-owner',
    exerciseOrder: 2,
    setNumber: 3,
    completedAt: '2026-02-15T11:00:00Z',
    ...overrides,
  };
}

describe('toPersonalBestView — one record per applicable metric', () => {
  it('labels and formats a max-load record with its owning session link', () => {
    expect(toPersonalBestView(best())).toEqual({
      key: 'max-load',
      metricLabel: 'Heaviest load',
      valueLabel: '82.5 kg',
      completedAtLabel: 'Feb 15, 2026',
      sessionHref: '/history/sessions/session-owner',
    });
  });

  it('labels and formats a bodyweight-reps record', () => {
    const view = toPersonalBestView(best({ metric: 'max-bodyweight-reps', value: 18 }));

    expect(view.metricLabel).toBe('Most bodyweight reps');
    expect(view.valueLabel).toBe('18 reps');
    expect(view.key).toBe('max-bodyweight-reps');
  });

  it('labels and formats a duration record in seconds', () => {
    const view = toPersonalBestView(best({ metric: 'max-duration', value: 75 }));

    expect(view.metricLabel).toBe('Longest duration');
    expect(view.valueLabel).toBe('75 sec');
    expect(view.key).toBe('max-duration');
  });

  it('links to the record’s own session even when another session holds an equal value', () => {
    // The repository already decided ownership (earliest owner on a tie). The
    // mapping must not re-derive it: the href is the delivered session id, so a
    // later equal maximum never replaces the owner.
    const owner = toPersonalBestView(best({ sessionId: 'session-earliest' }));
    const laterTie = toPersonalBestView(best({ sessionId: 'session-later' }));

    expect(owner.sessionHref).toBe('/history/sessions/session-earliest');
    expect(laterTie.sessionHref).toBe('/history/sessions/session-later');
  });
});

describe('personalBestValueLabel — formatting truthfulness', () => {
  it('renders a logged 0 kg as a real load', () => {
    expect(personalBestValueLabel(best({ value: 0 }))).toBe('0 kg');
  });

  it('trims float dust while keeping meaningful decimals', () => {
    expect(personalBestValueLabel(best({ value: 82.5 }))).toBe('82.5 kg');
    expect(personalBestValueLabel(best({ value: 82.5000001 }))).toBe('82.5 kg');
    expect(personalBestValueLabel(best({ value: 60 }))).toBe('60 kg');
  });

  it('renders reps as plain integers', () => {
    expect(personalBestValueLabel(best({ metric: 'max-bodyweight-reps', value: 18 }))).toBe(
      '18 reps',
    );
  });

  it('renders durations with the shared seconds convention', () => {
    expect(personalBestValueLabel(best({ metric: 'max-duration', value: 45 }))).toBe('45 sec');
  });
});

describe('toPersonalBestsView', () => {
  it('maps the delivered order unchanged', () => {
    const views = toPersonalBestsView([
      best({ metric: 'max-load', value: 82.5 }),
      best({ metric: 'max-bodyweight-reps', value: 18 }),
      best({ metric: 'max-duration', value: 75 }),
    ]);

    expect(views.map((view) => view.key)).toEqual([
      'max-load',
      'max-bodyweight-reps',
      'max-duration',
    ]);
    expect(views.map((view) => view.valueLabel)).toEqual(['82.5 kg', '18 reps', '75 sec']);
  });

  it('returns an empty list for an exercise without records (never a placeholder)', () => {
    expect(toPersonalBestsView([])).toEqual([]);
  });
});
