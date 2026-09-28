/**
 * M16 Slice 1 — M15 parity / drift guard (load-bearing).
 *
 * M16 refines two of M15's statuses: its single `completed` becomes
 * early / on-plan / late, and its single `planned` becomes today / upcoming.
 * Everything else must agree exactly, so for one shared fixture of planned
 * occurrences plus session facts the two taxonomies are compared with M16's
 * refinement normalized away. M17 adds the explicit not-performed fact, which
 * MUST normalize to itself in both.
 *
 * This test calls the REAL M15 domain logic (`resolvePlannedWorkoutStatus` from
 * `schedule-focus.ts`) and reimplements none of it. Its purpose is that a
 * future change to M15's status precedence forces an explicit review of M16
 * semantics instead of letting the two features contradict each other.
 */

import { describe, expect, it } from 'vitest';

import { createPlannedWorkout } from '@/domain/entities/planned-workout';
import { createScheduledWorkoutId } from '@/domain/types/ids';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';

import {
  PlannedWorkoutStatus,
  resolvePlannedWorkoutStatus,
  type PlannedWorkoutFacts,
} from '@/domain/services/schedule-focus';
import {
  FollowThroughOutcome,
  resolveFollowThroughOutcome,
  type PlannedOccurrenceFacts,
} from '@/domain/services/plan-follow-through';

const TODAY = '2026-09-28';

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(): PlannedWorkoutFacts['plannedWorkout']['scheduledWorkoutId'] {
  const id = createScheduledWorkoutId('sw-parity');
  if (!id.ok) throw new Error(id.error.message);
  return id.data;
}

interface OccurrenceInput {
  readonly plannedDate: string;
  readonly completedAt?: string;
  readonly active?: boolean;
  /** The explicit M17 not-performed fact, supplied to BOTH taxonomies. */
  readonly notPerformed?: boolean;
}

interface Scenario extends OccurrenceInput {
  readonly name: string;
  /** M16's expected outcome, including the early/on-plan/late refinement. */
  readonly m16: FollowThroughOutcome;
}

const COMPLETION_DAY_VARIANTS = {
  early: { plannedDate: '2026-09-30', completedAt: '2026-09-29T06:00:00.000Z' },
  onPlan: { plannedDate: '2026-09-30', completedAt: '2026-09-30T21:15:00.000Z' },
  late: { plannedDate: '2026-09-30', completedAt: '2026-10-01T00:00:00.000Z' },
} as const;

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    name: 'completes before its planned date',
    ...COMPLETION_DAY_VARIANTS.early,
    m16: FollowThroughOutcome.CompletedEarly,
  },
  {
    name: 'completes on its planned date',
    ...COMPLETION_DAY_VARIANTS.onPlan,
    m16: FollowThroughOutcome.CompletedOnPlan,
  },
  {
    name: 'completes after its planned date',
    ...COMPLETION_DAY_VARIANTS.late,
    m16: FollowThroughOutcome.CompletedLate,
  },
  {
    name: 'completes long after its planned date, with no live session',
    plannedDate: '2026-09-01',
    completedAt: '2026-09-20T09:00:00.000Z',
    m16: FollowThroughOutcome.CompletedLate,
  },
  {
    name: 'completes with a live session still attached',
    plannedDate: '2026-09-27',
    completedAt: '2026-09-27T09:00:00.000Z',
    active: true,
    m16: FollowThroughOutcome.CompletedOnPlan,
  },
  {
    name: 'is live on a past planned date',
    plannedDate: '2026-09-01',
    active: true,
    m16: FollowThroughOutcome.Started,
  },
  {
    name: 'is live on today',
    plannedDate: TODAY,
    active: true,
    m16: FollowThroughOutcome.Started,
  },
  {
    name: 'is live on a future planned date',
    plannedDate: '2026-10-05',
    active: true,
    m16: FollowThroughOutcome.Started,
  },
  {
    name: 'has no session on a past planned date',
    plannedDate: '2026-09-27',
    m16: FollowThroughOutcome.PastDue,
  },
  {
    name: 'has no session on today',
    plannedDate: TODAY,
    m16: FollowThroughOutcome.Today,
  },
  {
    name: 'has no session on a future planned date',
    plannedDate: '2026-10-05',
    m16: FollowThroughOutcome.Upcoming,
  },
  {
    name: 'is recorded as not performed on an already past planned date',
    plannedDate: '2026-09-27',
    notPerformed: true,
    m16: FollowThroughOutcome.NotPerformed,
  },
  {
    name: 'is recorded as not performed on today',
    plannedDate: TODAY,
    notPerformed: true,
    m16: FollowThroughOutcome.NotPerformed,
  },
  {
    name: 'is recorded as not performed on a future planned date',
    plannedDate: '2026-10-05',
    notPerformed: true,
    m16: FollowThroughOutcome.NotPerformed,
  },
];

/** The same occurrence as M15's fact shape consumes it. */
function m15Facts(input: OccurrenceInput): PlannedWorkoutFacts {
  const planned = createPlannedWorkout({
    enrollmentId: 'enr-1',
    scheduledWorkoutId: scheduledWorkoutId(),
    plannedDate: date(input.plannedDate),
  });
  if (!planned.ok) throw new Error(planned.error.message);

  return {
    plannedWorkout: planned.data,
    hasCompletedSession: input.completedAt !== undefined,
    hasActiveSession: input.active ?? false,
    hasNotPerformedRecord: input.notPerformed ?? false,
  };
}

/** The same occurrence as M16's fact shape consumes it. */
function m16Facts(input: OccurrenceInput): PlannedOccurrenceFacts {
  return {
    scheduledWorkoutId: scheduledWorkoutId(),
    plannedDate: date(input.plannedDate),
    completedAt: input.completedAt === undefined ? null : new Date(input.completedAt),
    hasActiveSession: input.active ?? false,
    hasNotPerformedRecord: input.notPerformed ?? false,
  };
}

/** Both taxonomies' answers for one occurrence. */
function evaluate(input: OccurrenceInput): {
  readonly m15: PlannedWorkoutStatus;
  readonly m16: FollowThroughOutcome;
} {
  return {
    m15: resolvePlannedWorkoutStatus(m15Facts(input), date(TODAY)),
    m16: resolveFollowThroughOutcome(m16Facts(input), date(TODAY)),
  };
}

/**
 * M16's outcome expressed on M15's statuses: the three completed variants
 * collapse back to `completed`, and `today`/`upcoming` collapse back to
 * `planned` (M15 does not distinguish today from a future date).
 */
function toPlannedWorkoutStatus(outcome: FollowThroughOutcome): PlannedWorkoutStatus {
  if (
    outcome === FollowThroughOutcome.CompletedEarly ||
    outcome === FollowThroughOutcome.CompletedOnPlan ||
    outcome === FollowThroughOutcome.CompletedLate
  ) {
    return PlannedWorkoutStatus.Completed;
  }
  if (outcome === FollowThroughOutcome.Started) {
    return PlannedWorkoutStatus.InProgress;
  }
  if (outcome === FollowThroughOutcome.NotPerformed) {
    return PlannedWorkoutStatus.NotPerformed;
  }
  if (outcome === FollowThroughOutcome.PastDue) {
    return PlannedWorkoutStatus.PastDue;
  }
  return PlannedWorkoutStatus.Planned;
}

describe('M16 follow-through vs M15 planned-workout status', () => {
  it.each(SCENARIOS)('$name', (scenario) => {
    const { m15, m16 } = evaluate(scenario);

    expect(m16).toBe(scenario.m16);
    expect(toPlannedWorkoutStatus(m16)).toBe(m15);
  });

  it('normalizes every completed variant back to M15 completed', () => {
    for (const variant of Object.values(COMPLETION_DAY_VARIANTS)) {
      const { m15, m16 } = evaluate(variant);

      expect(m15).toBe(PlannedWorkoutStatus.Completed);
      expect(toPlannedWorkoutStatus(m16)).toBe(m15);
    }
  });

  it('refines M15 planned into today and upcoming', () => {
    const plannedOutcomes = SCENARIOS.map((scenario) => evaluate(scenario))
      .filter(({ m15 }) => m15 === PlannedWorkoutStatus.Planned)
      .map(({ m16 }) => m16);

    expect(new Set(plannedOutcomes)).toEqual(
      new Set([FollowThroughOutcome.Today, FollowThroughOutcome.Upcoming]),
    );
  });

  it('covers all eight outcomes, so no refinement escapes the guard', () => {
    const covered = new Set(SCENARIOS.map((scenario) => evaluate(scenario).m16));

    expect(covered).toEqual(new Set(Object.values(FollowThroughOutcome)));
  });

  it('maps not-performed from the record alone, never from a date', () => {
    const recorded = SCENARIOS.filter((scenario) => scenario.notPerformed === true);
    const withoutRecord = SCENARIOS.filter((scenario) => scenario.notPerformed !== true);

    // Every date shape the fixture covers is represented with the fact, so the
    // guard would fail if either taxonomy started deriving it from a date.
    expect(recorded).not.toHaveLength(0);
    for (const scenario of withoutRecord) {
      expect(evaluate(scenario).m15).not.toBe(PlannedWorkoutStatus.NotPerformed);
      expect(evaluate(scenario).m16).not.toBe(FollowThroughOutcome.NotPerformed);
    }
    for (const scenario of recorded) {
      expect(evaluate(scenario)).toEqual({
        m15: PlannedWorkoutStatus.NotPerformed,
        m16: FollowThroughOutcome.NotPerformed,
      });
    }
  });
});
