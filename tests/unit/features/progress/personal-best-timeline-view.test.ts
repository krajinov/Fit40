/**
 * M18 Slice 6 — Progress personal-best timeline view mapping
 * (`docs/training-progress.md` §8.3–§8.5, §11).
 *
 * The DTO is the Application layer's own contract (Slice 5), so these tests pin
 * exactly what Presentation may not decide: the headline count is the EXACT
 * `recordEventCount` (never the row count), the rows keep the DTO's order and
 * are neither re-sorted nor re-sliced, still-stands context is read from the
 * supplied fact (never inferred from value equality), each row formats in its
 * metric's own unit and links to the session that holds the event, and a
 * catalog-unresolved event is omitted from rows without being backfilled or
 * changing the count.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ProgressRecordEventDto,
  ProgressRecordEventsDto,
} from '@/application/dto/training-progress';
import {
  PERSONAL_BESTS_EMPTY_BODY,
  PERSONAL_BESTS_EMPTY_TITLE,
  PERSONAL_BESTS_NONE_LABEL,
  PERSONAL_BESTS_UNRESOLVED_NOTE,
  FIRST_TIME_LABEL,
  SINCE_SURPASSED_LABEL,
  STILL_YOUR_BEST_LABEL,
} from '@/features/progress/progress-labels';
import {
  buildProgressRecordTimeline,
  toProgressRecordTimelineView,
  type ProgressRecordTimelineView,
} from '@/features/progress/personal-best-timeline-view';

/**
 * The composition root reaches the Drizzle repositories; stubbing it at the
 * feature boundary keeps these mapping tests database-free (the Slice 4
 * pattern). `buildProgressRecordTimeline` is exercised through the same stub.
 */
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock('@/features/progress/services', () => ({
  getTrainingProgressRecordEventsUseCase: { execute: executeMock },
}));

const NOW = new Date('2026-09-24T10:00:00.000Z');

function event(overrides: Partial<ProgressRecordEventDto> = {}): ProgressRecordEventDto {
  return {
    exerciseId: 'ex-002',
    exerciseName: 'Goblet Squat',
    exerciseSlug: 'goblet-squat',
    metric: 'max-load',
    value: 82.5,
    previousBest: 80,
    sessionId: 'session-a',
    completedAt: '2026-08-20T10:00:00.000Z',
    stillStanding: true,
    ...overrides,
  };
}

function dto(input: {
  readonly count: number;
  readonly events: ReadonlyArray<ProgressRecordEventDto>;
}): ProgressRecordEventsDto {
  return { recordEventCount: input.count, events: input.events };
}

/** The 12-event dataset D shape: ten renderable rows, an exact count of 12. */
function cappedTimeline(): ProgressRecordTimelineView {
  const rows = Array.from({ length: 10 }, (_unused, index) =>
    event({
      exerciseId: `ex-0${index + 1}`,
      exerciseName: `Exercise ${index + 1}`,
      sessionId: `session-${index + 1}`,
      completedAt: `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      value: 80 + index,
      previousBest: index === 0 ? null : 79 + index,
      stillStanding: index === 9,
    }),
  );
  return toProgressRecordTimelineView(dto({ count: 12, events: rows }));
}

/** Every string the timeline view can render — for vocabulary assertions. */
function allStrings(view: ProgressRecordTimelineView): ReadonlyArray<string> {
  return [
    view.title,
    view.caption,
    view.countCaption,
    view.capNote ?? '',
    view.emptyState?.title ?? '',
    view.emptyState?.body ?? '',
    view.unresolvedNote ?? '',
    view.summaryFragment,
    ...view.events.flatMap((row) => [
      row.exerciseName,
      row.metricLabel,
      row.valueLabel,
      row.completedAtLabel,
      row.previousBestLabel,
      row.standingLabel,
      row.sessionHref,
    ]),
  ];
}

describe('toProgressRecordTimelineView — exact count, cap and order', () => {
  const view = cappedTimeline();

  it('states the exact period count while rendering at most the supplied rows', () => {
    expect(view.recordEventCount).toBe(12);
    expect(view.events).toHaveLength(10);
    expect(view.countCaption).toBe('12 personal bests set in the last 13 weeks.');
    expect(view.capNote).toBe('Showing the 10 newest.');
    expect(view.summaryFragment).toBe('12 personal bests');
  });

  it('determines the cap note from the exact count, never from the rows alone', () => {
    const uncapped = toProgressRecordTimelineView(
      dto({ count: 3, events: [event({ sessionId: 's-1' }), event({ sessionId: 's-2' })] }),
    );

    expect(uncapped.recordEventCount).toBe(3);
    // Three events, two renderable rows, but nothing was capped by the display
    // limit: the note belongs to the newest-N selection, not to this difference.
    expect(uncapped.capNote).toBe('Showing the 2 newest.');
    expect(toProgressRecordTimelineView(dto({ count: 2, events: [event(), event()] })).capNote).toBe(
      null,
    );
  });

  it('keeps the DTO order and never re-sorts it by date', () => {
    // Deliberately out of chronological order: the view must not "fix" it. The
    // newest-N selection and the ordering happen in Application (memo §8.4).
    const shuffled = toProgressRecordTimelineView(
      dto({
        count: 2,
        events: [
          event({ exerciseName: 'Newest first', completedAt: '2026-09-01T10:00:00.000Z' }),
          event({ exerciseName: 'Oldest second', completedAt: '2026-07-01T10:00:00.000Z' }),
        ],
      }),
    );

    expect(shuffled.events.map((row) => row.exerciseName)).toEqual([
      'Newest first',
      'Oldest second',
    ]);
  });

describe('toProgressRecordTimelineView — row facts', () => {
  it('renders first-exposure wording and previous values in the metric’s own unit', () => {
    const view = toProgressRecordTimelineView(
      dto({
        count: 4,
        events: [
          event({ previousBest: null, value: 20 }),
          event({ previousBest: 20, metric: 'max-load', value: 25 }),
          event({ previousBest: 11, metric: 'max-bodyweight-reps', value: 12 }),
          event({ previousBest: 60, metric: 'max-duration', value: 75 }),
        ],
      }),
    );

    const rows = view.events;
    expect(rows[0]?.previousBestLabel).toBe(FIRST_TIME_LABEL);
    expect(rows[0]?.valueLabel).toBe('20 kg');
    expect(rows[1]?.previousBestLabel).toBe('Previous best 20 kg');
    expect(rows[1]?.valueLabel).toBe('25 kg');
    expect(rows[2]?.previousBestLabel).toBe('Previous best 11 reps');
    expect(rows[2]?.valueLabel).toBe('12 reps');
    expect(rows[3]?.previousBestLabel).toBe('Previous best 60 sec');
    expect(rows[3]?.valueLabel).toBe('75 sec');
  });

  it('reads still-stands from the supplied fact, never from value equality', () => {
    // Two events with the SAME value: only the DTO's ownership fact separates
    // them, so a value comparison could not produce these two labels.
    const view = toProgressRecordTimelineView(
      dto({
        count: 2,
        events: [
          event({ sessionId: 'session-e', value: 25, stillStanding: false }),
          event({ sessionId: 'session-d', value: 25, stillStanding: true }),
        ],
      }),
    );

    expect(view.events[0]?.standingLabel).toBe(SINCE_SURPASSED_LABEL);
    expect(view.events[0]?.stillStanding).toBe(false);
    expect(view.events[1]?.standingLabel).toBe(STILL_YOUR_BEST_LABEL);
    expect(view.events[1]?.stillStanding).toBe(true);
  });

  it('links every row to the completed session that holds the event', () => {
    const view = toProgressRecordTimelineView(
      dto({ count: 1, events: [event({ sessionId: 'session-xyz', completedAt: '2026-09-21T18:30:00.000Z' })] }),
    );

    expect(view.events[0]?.sessionHref).toBe('/history/sessions/session-xyz');
    expect(view.events[0]?.completedAtLabel).toBe('Sep 21, 2026');
    expect(view.events[0]?.metricLabel).toBe('Heaviest load');
  });

  it('keeps same-session events as distinct rows', () => {
    // Two events of one session: the same href is correct, and the keys must
    // still differ or React would collapse one row into the other.
    const view = toProgressRecordTimelineView(
      dto({
        count: 2,
        events: [
          event({ sessionId: 'session-same', exerciseId: 'ex-001', metric: 'max-load' }),
          event({ sessionId: 'session-same', exerciseId: 'ex-001', metric: 'max-duration' }),
        ],
      }),
    );

    const keys = view.events.map((row) => row.key);
    expect(new Set(keys).size).toBe(2);
    expect(view.events.map((row) => row.sessionHref)).toEqual([
      '/history/sessions/session-same',
      '/history/sessions/session-same',
    ]);
  });
});

});

describe('toProgressRecordTimelineView — empty, unresolved and degraded states', () => {
  it('renders the empty state only for a genuine zero count', () => {
    const view = toProgressRecordTimelineView(dto({ count: 0, events: [] }));

    expect(view.emptyState).toEqual({
      title: PERSONAL_BESTS_EMPTY_TITLE,
      body: PERSONAL_BESTS_EMPTY_BODY,
    });
    expect(view.countCaption).toBe(PERSONAL_BESTS_NONE_LABEL);
    expect(view.capNote).toBeNull();
    expect(view.unresolvedNote).toBeNull();
    expect(view.summaryFragment).toBe('0 personal bests');
  });

  it('omits an unresolved event without backfilling a row or changing the count', () => {
    // The count is exact; no row renders because the catalog cannot name it, and
    // the view states that instead of inventing a row or dropping the count.
    const view = toProgressRecordTimelineView(dto({ count: 3, events: [] }));

    expect(view.recordEventCount).toBe(3);
    expect(view.events).toEqual([]);
    expect(view.emptyState).toBeNull();
    expect(view.unresolvedNote).toBe(PERSONAL_BESTS_UNRESOLVED_NOTE);
    expect(view.countCaption).toBe('3 personal bests set in the last 13 weeks.');
    expect(view.summaryFragment).toBe('3 personal bests');
  });

  it('never states the unresolved note while any row renders', () => {
    expect(cappedTimeline().unresolvedNote).toBeNull();
  });
});

describe('toProgressRecordTimelineView — product vocabulary (§11)', () => {
  it('states that these are historical events, not current bests', () => {
    const view = cappedTimeline();

    expect(view.title).toBe('Personal bests in the last 13 weeks');
    expect(view.caption).toContain('not necessarily your current best');
    // The context of a row is one of the two locked states, never a claim that
    // every event still stands.
    for (const row of view.events) {
      expect([STILL_YOUR_BEST_LABEL, SINCE_SURPASSED_LABEL]).toContain(row.standingLabel);
    }
  });

  it('uses no prohibited wording, and never the volume unit for a record value', () => {
    const rendered = [
      cappedTimeline(),
      toProgressRecordTimelineView(dto({ count: 0, events: [] })),
      toProgressRecordTimelineView(
        dto({ count: 2, events: [event({ previousBest: null, metric: 'max-duration' })] }),
      ),
    ]
      .flatMap(allStrings)
      .join(' ')
      .toLowerCase();

    for (const banned of [
      'adherence',
      'streak',
      'missed',
      'failed',
      'on track',
      'off track',
      'readiness',
      'fatigue',
      'recovery',
      'score',
      'calorie',
      'weeks you trained',
      'getting stronger',
      'trophy',
      'confetti',
    ]) {
      expect(rendered).not.toContain(banned);
    }
    // `kg × reps` is the period volume unit; a record value is one load, one rep
    // count or one duration.
    expect(rendered).not.toContain('kg × reps');
  });
});

describe('buildProgressRecordTimeline', () => {
  it('maps a successful read and passes the single request clock through', async () => {
    executeMock.mockResolvedValue({ ok: true, data: dto({ count: 1, events: [event()] }) });

    const state = await buildProgressRecordTimeline('user-a', NOW);

    expect(executeMock).toHaveBeenCalledWith({ userId: 'user-a', now: NOW });
    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.data.recordEventCount).toBe(1);
    expect(state.data.events).toHaveLength(1);
    expect(state.data.events[0]?.sessionHref).toBe('/history/sessions/session-a');
  });

  it('degrades a typed rejection to unavailable — never to a zero count', async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad user id' },
    });

    expect(await buildProgressRecordTimeline('user-a', NOW)).toEqual({ status: 'unavailable' });
  });

  it('degrades an unexpected failure to unavailable and logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeMock.mockRejectedValue(new Error('database unreachable'));

    expect(await buildProgressRecordTimeline('user-a', NOW)).toEqual({ status: 'unavailable' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});


