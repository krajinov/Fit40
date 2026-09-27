/**
 * @vitest-environment jsdom
 *
 * M16 Slice 4 tests for the plan follow-through section: the two truthful states
 * (an unconfigured run renders nothing at all — its setup belongs to the M15
 * schedule section — while a configured run renders its weeks and totals), the
 * locked framing and the single approved disclosure, week ranges in text, the
 * current week marked by words and `aria-current` rather than colour, real zeros
 * displayed as zeros, DTO values shown exactly as supplied, and no interactive
 * control, percentage or judgemental vocabulary anywhere.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  ConfiguredFollowThroughDto,
  EnrollmentFollowThroughDto,
  FollowThroughWeekDto,
} from '@/application/dto/follow-through';
import { PlanFollowThroughSection } from '@/features/schedule/components/PlanFollowThroughSection';
import {
  FOLLOW_THROUGH_DISCLOSURE,
  FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE,
} from '@/features/schedule/follow-through-view';

/** Wednesday 2026-09-23 sits in the week starting Monday 2026-09-21. */
const TODAY = '2026-09-23';

const ZERO_COUNTS = {
  planned: 0,
  completed: 0,
  completedEarly: 0,
  completedLate: 0,
  started: 0,
  pastDue: 0,
} as const;

function week(overrides: Partial<FollowThroughWeekDto> = {}): FollowThroughWeekDto {
  return {
    weekStart: '2026-09-21T00:00:00.000Z',
    weekEnd: '2026-09-28T00:00:00.000Z',
    closed: false,
    planned: 3,
    completed: 2,
    completedEarly: 0,
    completedLate: 0,
    started: 0,
    pastDue: 1,
    ...overrides,
  };
}

function report(overrides: Partial<ConfiguredFollowThroughDto> = {}): ConfiguredFollowThroughDto {
  return {
    programSlug: 'prog-1',
    today: TODAY,
    configured: true,
    weeks: [week()],
    totals: {
      planned: 3,
      completed: 2,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 1,
    },
    ...overrides,
  };
}

function unconfigured(): EnrollmentFollowThroughDto {
  return { programSlug: 'prog-1', today: TODAY, configured: false };
}

function render(dto: EnrollmentFollowThroughDto): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    createElement(PlanFollowThroughSection, { followThrough: dto }),
  );
  return container;
}

describe('PlanFollowThroughSection', () => {
  it('renders nothing for an unconfigured run', () => {
    const container = render(unconfigured());

    // No setup card, no zero weeks, no zero totals, no call to action: M15 owns
    // schedule configuration.
    expect(container.innerHTML).toBe('');
    expect(container.textContent).toBe('');
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders the locked framing and the single disclosure', () => {
    const container = render(report());

    expect(container.querySelector('h2')?.textContent).toBe('This plan so far');
    expect(container.textContent).toContain('last 8 weeks');
    // Exactly one disclosure — no second UTC or consistency line.
    expect(container.textContent?.split(FOLLOW_THROUGH_DISCLOSURE)).toHaveLength(2);
    expect(container.textContent).not.toContain('UTC');
  });

  it('renders each week as a text range with the DTO counts', () => {
    const container = render(
      report({
        weeks: [
          week({
            weekStart: '2026-09-14T00:00:00.000Z',
            weekEnd: '2026-09-21T00:00:00.000Z',
            closed: true,
            planned: 2,
            completed: 1,
            pastDue: 1,
          }),
          week({ closed: false, planned: 3, completed: 2, pastDue: 0 }),
        ],
      }),
    );

    const rows = [...container.querySelectorAll('li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Sep 14–20');
    expect(rows[0]?.textContent).toContain('1 of 2 done');
    expect(rows[0]?.textContent).toContain('1 past due');
    expect(rows[1]?.textContent).toContain('Sep 21–27');
    expect(rows[1]?.textContent).toContain('2 of 3 done');
    // A zero past-due count is not rendered as a row badge.
    expect(rows[1]?.textContent).not.toContain('past due');
    expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe(
      'Plan follow-through by week',
    );
  });

  it('shows the current week in words and semantics, never colour alone', () => {
    const container = render(
      report({
        weeks: [
          week({
            weekStart: '2026-09-14T00:00:00.000Z',
            weekEnd: '2026-09-21T00:00:00.000Z',
            closed: true,
          }),
          week(),
          week({
            weekStart: '2026-09-28T00:00:00.000Z',
            weekEnd: '2026-10-05T00:00:00.000Z',
            closed: false,
          }),
        ],
      }),
    );

    const current = [...container.querySelectorAll('li[aria-current="date"]')];
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('This week');
    expect(current[0]?.textContent).toContain('Sep 21–27');
    // The provisional future week is not marked, and no row is framed as
    // unfinished, failed or behind.
    expect(container.textContent?.match(/This week/g)).toHaveLength(1);
  });

  it('renders the section totals, including early and late context', () => {
    const container = render(
      report({
        totals: {
          planned: 9,
          completed: 6,
          completedEarly: 2,
          completedLate: 1,
          started: 1,
          pastDue: 3,
        },
      }),
    );

    expect(container.textContent).toContain(
      '9 planned · 6 done · 2 completed early · 1 completed late · 1 started · 3 past due',
    );
  });

  it('keeps real zeros as zeros and stays factual with a zero-reporting week', () => {
    const container = render(
      report({
        weeks: [week({ planned: 3, completed: 0, pastDue: 0, started: 0 })],
        totals: { ...ZERO_COUNTS },
      }),
    );

    expect(container.textContent).toContain('0 of 3 done');
    expect(container.textContent).toContain('0 planned · 0 done');
    expect(container.textContent).not.toContain('completed early');
    expect(container.textContent).not.toContain('completed late');
  });

  it('renders an empty horizon as its own honest statement, never zero totals', () => {
    const container = render(report({ weeks: [], totals: { ...ZERO_COUNTS } }));

    expect(container.textContent).toContain(FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE);
    expect(container.textContent).not.toContain('0 planned');
    expect(container.querySelector('ul')).toBeNull();
    expect(container.textContent).toContain(FOLLOW_THROUGH_DISCLOSURE);
  });

  it('displays the supplied DTO values without correcting them', () => {
    const container = render(
      report({
        // Self-inconsistent on purpose: the totals disagree with the week, and
        // the week's completed count exceeds its planned count. The section shows
        // what the application said.
        weeks: [week({ planned: 1, completed: 4 })],
        totals: {
          planned: 1,
          completed: 4,
          completedEarly: 4,
          completedLate: 0,
          started: 0,
          pastDue: 0,
        },
      }),
    );

    expect(container.textContent).toContain('4 of 1 done');
    expect(container.textContent).toContain('1 planned · 4 done · 4 completed early');
  });

  it('carries no CTA, percentage or judgemental vocabulary', () => {
    const container = render(report({ weeks: [week({ planned: 4, completed: 1, pastDue: 3 })] }));
    const text = container.textContent?.toLowerCase() ?? '';

    expect(container.querySelectorAll('button, a, input, select, textarea, details')).toHaveLength(0);
    expect(text).not.toContain('%');
    for (const banned of [
      'missed',
      'failed',
      'skipped',
      'streak',
      'adherence',
      'score',
      'goal',
      'on track',
      'off track',
      'set your training days',
      'no training days',
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});
