/**
 * Presentation tests for the M14 completion view mapping (Slice 6): the
 * completed-run DTO is mapped faithfully — identity, dates, tallies, the
 * EXACT record-event count, per-metric value formatting and session links —
 * and the capped display list is rendered exactly as supplied, never
 * reconstructed. The wording stays historical ("during this run"), never
 * M13's current-PB language.
 */

import { describe, expect, it } from 'vitest';

import type {
  ProgramCompletionCompletedDto,
  ProgramCompletionRecordEventDto,
} from '@/application/dto/program-completion';
import { buildProgramCompletionView } from '@/features/enrollment/completion-view';

function recordEvent(
  overrides?: Partial<ProgramCompletionRecordEventDto>,
): ProgramCompletionRecordEventDto {
  return {
    exerciseId: 'ex-1',
    exerciseName: 'Goblet Squat',
    exerciseSlug: 'goblet-squat',
    metric: 'max-load',
    value: 82.5,
    previousBest: 80,
    sessionId: 'session-1',
    completedAt: '2026-02-10T18:00:00.000Z',
    ...overrides,
  };
}

function completedDto(
  overrides?: Partial<ProgramCompletionCompletedDto>,
): ProgramCompletionCompletedDto {
  return {
    status: 'completed',
    programName: 'Fit40 Beginner Strength',
    programSlug: 'fit40-beginner-strength',
    completedWorkouts: 12,
    totalWorkouts: 12,
    completedAt: '2026-02-15T10:30:00.000Z',
    distinctExercises: 7,
    recordEventCount: 1,
    recordEvents: [recordEvent()],
    ...overrides,
  };
}

describe('buildProgramCompletionView', () => {
  it('maps the program identity and page hrefs from the completed DTO', () => {
    const view = buildProgramCompletionView(completedDto());

    expect(view.programName).toBe('Fit40 Beginner Strength');
    expect(view.programSlug).toBe('fit40-beginner-strength');
    expect(view.programHref).toBe('/programs/fit40-beginner-strength');
    expect(view.catalogHref).toBe('/programs');
  });

  it('formats the completion date with the deterministic UTC history format', () => {
    const view = buildProgramCompletionView(completedDto());

    expect(view.completionDateLabel).toBe('Feb 15, 2026');
  });

  it('formats the workout tally from the DTO counters', () => {
    expect(buildProgramCompletionView(completedDto()).workoutTallyLabel).toBe('12 of 12');
    expect(
      buildProgramCompletionView(completedDto({ completedWorkouts: 9 })).workoutTallyLabel,
    ).toBe('9 of 12');
  });

  it('carries the distinct exercise count through unchanged', () => {
    const view = buildProgramCompletionView(completedDto({ distinctExercises: 7 }));

    expect(view.distinctExercises).toBe(7);
  });

  it('keeps the exact PR-event count even when the display list is capped', () => {
    const capped: ReadonlyArray<ProgramCompletionRecordEventDto> = [
      recordEvent({ sessionId: 's5' }),
      recordEvent({ sessionId: 's4' }),
      recordEvent({ sessionId: 's3' }),
      recordEvent({ sessionId: 's2' }),
      recordEvent({ sessionId: 's1' }),
    ];
    const view = buildProgramCompletionView(
      completedDto({ recordEventCount: 9, recordEvents: capped }),
    );

    expect(view.recordEventCount).toBe(9);
    expect(view.recordEvents).toHaveLength(5);
    expect(view.recordEventsNote).toBe('Showing the 5 most recent.');
  });

  it("formats each PR event's metric and value in its own unit", () => {
    const view = buildProgramCompletionView(
      completedDto({
        recordEventCount: 3,
        recordEvents: [
          recordEvent({ metric: 'max-load', value: 82.5 }),
          recordEvent({ metric: 'max-bodyweight-reps', value: 18, exerciseName: 'Push-up' }),
          recordEvent({ metric: 'max-duration', value: 75, exerciseName: 'Plank' }),
        ],
      }),
    );

    expect(view.recordEvents.map((event) => event.metricLabel)).toEqual([
      'Heaviest load',
      'Most bodyweight reps',
      'Longest duration',
    ]);
    expect(view.recordEvents.map((event) => event.valueLabel)).toEqual([
      '82.5 kg',
      '18 reps',
      '75 sec',
    ]);
  });

  it('links each PR event to the completed session that owns it', () => {
    const view = buildProgramCompletionView(completedDto());

    expect(view.recordEvents[0]?.sessionHref).toBe('/history/sessions/session-1');
    expect(view.recordEvents[0]?.completedAtLabel).toBe('Feb 10, 2026');
  });

  it('renders the supplied DTO list as-is, without reconstructing omitted events', () => {
    const supplied = [recordEvent({ sessionId: 's1' }), recordEvent({ sessionId: 's2' })];
    const view = buildProgramCompletionView(
      completedDto({ recordEventCount: 2, recordEvents: supplied }),
    );

    expect(view.recordEvents).toHaveLength(2);
    expect(view.recordEvents.map((event) => event.sessionHref)).toEqual([
      '/history/sessions/s1',
      '/history/sessions/s2',
    ]);
    expect(view.recordEventsNote).toBeNull();
    expect(new Set(view.recordEvents.map((event) => event.key)).size).toBe(2);
  });

  it('is honest about zero PR events', () => {
    const view = buildProgramCompletionView(
      completedDto({ recordEventCount: 0, recordEvents: [] }),
    );

    expect(view.recordEventCount).toBe(0);
    expect(view.recordEvents).toEqual([]);
    expect(view.recordEventsNote).toBeNull();
    expect(view.recordCountCaption).toBe('No records during this run.');
  });

  it('distinguishes historical program records from current personal bests in the caption', () => {
    const view = buildProgramCompletionView(
      completedDto({ recordEventCount: 9, recordEvents: [recordEvent()] }),
    );

    expect(view.recordCountCaption).toContain(
      'historical records, not current personal bests',
    );
    expect(view.recordCountCaption).not.toContain('this week');
  });
});