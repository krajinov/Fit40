/**
 * Route-contract tests for /programs/[programSlug] with the M15 schedule
 * section (Slice 6). Follows the program-completed-page pattern: auth,
 * composition roots and enrollment actions are mocked, and the async Server
 * Component is inspected with renderToStaticMarkup.
 *
 * Pinned: the schedule read happens only for an ENROLLED, NOT-COMPLETED run,
 * through the composed GetEnrollmentScheduleUseCase (no repository in
 * presentation), with the page's single server-owned `now` clock and the SAME
 * already-hydrated program aggregate; failures degrade that section only
 * (logged, never "unconfigured"); the M14 completed state keeps its restart /
 * leave surface with no scheduling section; authored week/workout navigation
 * stays intact; and no EnrollmentId or user id reaches the markup. Slice 6 is
 * read-only — no schedule mutation form exists yet.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const {
  notFoundMock,
  getCurrentUserMock,
  enrollmentExecute,
  closureExecute,
  programExecute,
  resolveNextExecute,
  scheduleExecute,
  followThroughExecute,
} = vi.hoisted(() => {
  const notFound = vi.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    error.name = 'NEXT_NOT_FOUND';
    throw error;
  });
  return {
    notFoundMock: notFound,
    getCurrentUserMock: vi.fn(),
    enrollmentExecute: vi.fn(),
    closureExecute: vi.fn(),
    programExecute: vi.fn(),
    resolveNextExecute: vi.fn(),
    scheduleExecute: vi.fn(),
    followThroughExecute: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: getCurrentUserMock }));

vi.mock('@/features/enrollment/services', () => ({
  getProgramEnrollmentUseCase: { execute: enrollmentExecute },
  getRunClosureSummaryUseCase: { execute: closureExecute },
}));

vi.mock('@/features/programs/services', () => ({
  getProgramBySlugUseCase: { execute: programExecute },
}));

vi.mock('@/features/sessions/services', () => ({
  resolveNextWorkoutUseCase: { execute: resolveNextExecute },
}));

vi.mock('@/features/schedule/services', () => ({
  getEnrollmentScheduleUseCase: { execute: scheduleExecute },
  getEnrollmentFollowThroughUseCase: { execute: followThroughExecute },
}));

// M16 Slice 5: presentation reaches the database only through the composed use
// cases above. The page and its sections import no repository module today; if
// one ever did, it would load this module and the factory fails loudly instead
// of quietly connecting to a database during a unit test.
vi.mock('@/infrastructure/database/repositories', () => {
  throw new Error('presentation must not import database repositories directly');
});

// The enrollment leaves AND the Slice 7 scheduling leaves post to Server
// Actions that pull the DB composition root; stubbed at the module boundary
// (the program-completed-page pattern).
vi.mock('@/features/enrollment/actions/join-program', () => ({
  joinProgramAction: vi.fn(),
}));
vi.mock('@/features/enrollment/actions/leave-program', () => ({
  leaveProgramAction: vi.fn(),
}));
vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: vi.fn(),
}));
vi.mock('@/features/schedule/actions/configure-training-days', () => ({
  configureTrainingDaysAction: vi.fn(),
}));
vi.mock('@/features/schedule/actions/reschedule-planned-workout', () => ({
  reschedulePlannedWorkoutAction: vi.fn(),
}));

import ProgramDetailPage from '@/app/(app)/programs/[programSlug]/page';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

const SLUG = 'fit40-beginner-strength';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_USER = { id: USER_ID, email: 'user@example.com', createdAt: '2026-01-01T00:00:00.000Z' };

const PROGRAM_AGGREGATE = {
  id: 'p1',
  slug: SLUG,
  name: 'Fit40 Beginner Strength',
};

const PROGRAM_DETAIL = {
  id: 'p1',
  name: 'Fit40 Beginner Strength',
  slug: SLUG,
  description: 'A program.',
  difficulty: 'beginner',
  goal: 'strength',
  durationWeeks: 4,
  workoutsPerWeek: 3,
  weeks: [
    {
      weekNumber: 1,
      scheduledWorkouts: [
        {
          scheduledWorkoutId: 'sw-1',
          workoutId: 'wo-1',
          workoutName: 'Upper Body A',
          workoutSlug: 'upper-body-a',
          order: 1,
          estimatedDurationMinutes: 30,
        },
        {
          scheduledWorkoutId: 'sw-2',
          workoutId: 'wo-2',
          workoutName: 'Lower Body B',
          workoutSlug: 'lower-body-b',
          order: 2,
          estimatedDurationMinutes: 45,
        },
        {
          scheduledWorkoutId: 'sw-3',
          workoutId: 'wo-3',
          workoutName: 'Conditioning C',
          workoutSlug: 'conditioning-c',
          order: 3,
          estimatedDurationMinutes: 25,
        },
      ],
    },
  ],
} as const;

const ENROLLED_INCOMPLETE = {
  status: 'enrolled',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  progress: { totalWorkouts: 12, completedWorkouts: 5, percentage: 42 },
  nextWorkout: { weekNumber: 1, workoutOrder: 2 },
  completedScheduledWorkoutIds: [] as ReadonlyArray<string>,
} as const;

const ENROLLED_COMPLETE = {
  status: 'enrolled',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  progress: { totalWorkouts: 12, completedWorkouts: 12, percentage: 100 },
  nextWorkout: null,
  completedScheduledWorkoutIds: ['sw-1'],
} as const;

const NOT_ENROLLED = { status: 'not-enrolled' } as const;

function rep() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const NEXT_DTO = {
  programSlug: SLUG,
  weekNumber: 1,
  workoutOrder: 2,
  workoutName: 'Lower Body B',
  exerciseCount: 4,
  estimatedMinutes: 45,
  preview: [{ order: 1, exerciseName: 'Squat', prescription: rep() }],
  sessionState: 'not-started',
} as const;

function scheduleDto(configured = true) {
  const item = {
    scheduledWorkoutId: 'sw-2',
    weekNumber: 1,
    workoutOrder: 2,
    workoutName: 'Lower Body B',
    plannedDate: '2026-09-23',
    status: 'planned',
  } as const;
  // configured:true implies rows exist (the use case derives it from the
  // planned-row read), so the fixture keeps an item when configured.
  return {
    programSlug: SLUG,
    configured,
    today: '2026-09-23',
    items: configured ? [item] : [],
    unplacedNotPerformedWorkouts: [],
    focus: configured
      ? { today: item, next: null, pastDue: null }
      : { today: null, next: null, pastDue: null },
  };
}

async function renderPage(): Promise<string> {
  const element = await ProgramDetailPage({
    params: Promise.resolve({ programSlug: SLUG }),
  });
  return renderToStaticMarkup(element);
}

/** The M16 follow-through DTO: one open week with one past-due occurrence. */
function followThroughDto(configured = true) {
  if (!configured) {
    return {
      programSlug: SLUG,
      today: '2026-09-23',
      configured: false as const,
      notPerformedUnplaced: 0,
    };
  }

  return {
    programSlug: SLUG,
    today: '2026-09-23',
    configured: true as const,
    weeks: [
      {
        weekStart: '2026-09-21T00:00:00.000Z',
        weekEnd: '2026-09-28T00:00:00.000Z',
        closed: false,
        planned: 3,
        completed: 2,
        completedEarly: 0,
        completedLate: 1,
        started: 0,
        pastDue: 1,
      },
    ],
    totals: {
      planned: 3,
      completed: 2,
      completedEarly: 0,
      completedLate: 1,
      started: 0,
      pastDue: 1,
    },
  };
}

/**
 * The M17 Slice 10 run-closure DTO: six authored occurrences, four completed,
 * one recorded, one still open — concluded false, so the page resolves the
 * up-next affordance from its first open occurrence (Slice 11). The open
 * occurrence coincides with the M14 next workout by default; the divergence case
 * is exercised with an override.
 */
function runClosureDto(overrides: Record<string, unknown> = {}) {
  return {
    programSlug: SLUG,
    totalWorkouts: 6,
    completedWorkouts: 4,
    notPerformedWorkouts: 1,
    openWorkouts: 1,
    hasOpenWorkout: true,
    openInProgramOrder: [
      { scheduledWorkoutId: 'sw-2', weekNumber: 1, workoutOrder: 2, workoutName: 'Cardio' },
    ],
    isConcluded: false,
    isProgramComplete: false,
    restartAvailable: false,
    ...overrides,
  };
}

describe('/programs/[programSlug] page (M15 Slice 6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCurrentUserMock.mockResolvedValue(SESSION_USER);
    programExecute.mockResolvedValue({
      ok: true,
      data: { detail: PROGRAM_DETAIL, program: PROGRAM_AGGREGATE },
    });
    enrollmentExecute.mockResolvedValue({ ok: true, data: ENROLLED_INCOMPLETE });
    resolveNextExecute.mockResolvedValue(NEXT_DTO);
    scheduleExecute.mockResolvedValue({ ok: true, data: scheduleDto() });
    followThroughExecute.mockResolvedValue({ ok: true, data: followThroughDto() });
    closureExecute.mockResolvedValue({ ok: true, data: runClosureDto() });
  });

  it('never reads or renders a schedule for anonymous visitors', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(followThroughExecute).not.toHaveBeenCalled();
    expect(closureExecute).not.toHaveBeenCalled();
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('This plan so far');
    expect(markup).toContain('Weekly schedule');
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
  });

  it('never reads or renders a schedule for a signed-in not-enrolled visitor', async () => {
    enrollmentExecute.mockResolvedValue({ ok: true, data: NOT_ENROLLED });

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(followThroughExecute).not.toHaveBeenCalled();
    expect(closureExecute).not.toHaveBeenCalled();
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('This plan so far');
    expect(markup).toContain('Join this program');
  });

  it('reads the schedule for an enrolled run through the composition root, with the same aggregate and a server clock', async () => {
    const markup = await renderPage();

    // Data arrives through the composed GetEnrollmentScheduleUseCase — no
    // repository is reachable from the page (Slice 6 test 21) — and the read
    // reuses the aggregate this page already hydrated (one catalog load).
    expect(scheduleExecute).toHaveBeenCalledTimes(1);
    const input = scheduleExecute.mock.calls[0]?.[0];
    expect(input).toMatchObject({ userId: USER_ID });
    expect(input?.program).toBe(PROGRAM_AGGREGATE);
    expect(input?.now).toBeInstanceOf(Date);

    // M17 Slice 10: the closure summary rides the composed read with the SAME
    // aggregate — and deliberately carries no request clock, because
    // conclusion is not a date consequence.
    expect(closureExecute).toHaveBeenCalledTimes(1);
    const closureInput = closureExecute.mock.calls[0]?.[0];
    expect(closureInput).toMatchObject({ userId: USER_ID });
    expect(closureInput?.program).toBe(PROGRAM_AGGREGATE);
    expect(closureInput?.now).toBeUndefined();

    expect(markup).toContain('aria-label="Training schedule"');
    expect(markup).toContain('aria-label="This week"');
    expect(markup).toContain('Training schedule');
    // The existing up-next surface is preserved alongside the calendar.
    expect(markup).toContain('UP NEXT');
  });

  it('renders the setup state for an enrolled but unconfigured run', async () => {
    scheduleExecute.mockResolvedValue({ ok: true, data: scheduleDto(false) });

    const markup = await renderPage();

    expect(markup).toContain('id="training-schedule"');
    expect(markup).toContain('No training days set yet.');
    // The approved setup helper renders (exact text + occurrence counts are
    // pinned in the section's own tests via decoded textContent).
    expect(markup).toContain('UTC calendar — the same calendar your weekly insights use.');
    // Slice 7: the real configuration form renders here — seven weekday
    // controls and the setup submit — and none is pre-checked (M15 stores
    // dates, not weekdays, so no stored preference is claimed).
    expect(markup).toContain('name="weekday"');
    expect(markup).toContain('Set training days');
    expect(markup).not.toMatch(/name="weekday"[^>]*checked/);
  });

  it('keeps the M14 completed state authoritative: no schedule read, no section, restart/leave intact', async () => {
    enrollmentExecute.mockResolvedValue({ ok: true, data: ENROLLED_COMPLETE });
    closureExecute.mockResolvedValue({
      ok: true,
      data: runClosureDto({ isConcluded: true, isProgramComplete: true, restartAvailable: true }),
    });

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(followThroughExecute).not.toHaveBeenCalled();
    // The closure summary IS loaded for a complete run — it is factual state —
    // but Slice 10 draws no lifecycle conclusion from it: the M14 surface
    // above stays the only state rendered, and none of the DTO's labels leak.
    expect(closureExecute).toHaveBeenCalledTimes(1);
    expect(markup).not.toContain('Cardio');
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('id="training-schedule"');
    expect(markup).not.toContain('This plan so far');
    // The M14 lifecycle surface stays: summary, restart and leave.
    expect(markup).toContain('View completion summary');
    expect(markup).toContain('Start program again');
    expect(markup).toContain('Leave plan');
    expect(markup).toContain('Program completed — every workout is done.');
  });

  it('carries the closure summary without rendering its counts or open-occurrence labels', async () => {
    const markup = await renderPage();

    // Loaded once, for the enrolled run, through the composed use case.
    expect(closureExecute).toHaveBeenCalledTimes(1);
    // Only the open occurrence's IDENTITY (its public coordinates) drives the
    // up-next selection; the DTO's counts, open-occurrence labels and verdict
    // copy never reach the markup (Slice 11 renders none of that).
    expect(markup).not.toContain('Cardio');
    expect(markup).not.toContain('4 completed');
    expect(markup).not.toContain('concluded');
    // Every existing surface is unchanged.
    expect(markup).toContain('Weekly schedule');
    expect(markup).toContain('aria-label="Training schedule"');
    expect(markup).toContain('This plan so far');
  });

  it('surfaces a recorded occurrence on its authored card with Undo (M17 Slice 11)', async () => {
    // The M15 read resolved the week-1 occurrence as `not-performed`; the page
    // passes that user-scoped fact down to the authored schedule cards.
    scheduleExecute.mockResolvedValue({
      ok: true,
      data: {
        ...scheduleDto(),
        items: [
          {
            scheduledWorkoutId: 'sw-1',
            weekNumber: 1,
            workoutOrder: 1,
            workoutName: 'Upper Body A',
            plannedDate: '2026-09-23',
            status: 'not-performed',
          },
        ],
        focus: { today: null, next: null, pastDue: null },
      },
    });

    const markup = await renderPage();

    expect(markup).toContain('Recorded as not performed');
    expect(markup).toContain('>Undo<');
    // No Start control is offered for it, and its detail link survives.
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
  });

  it('resolves the up-next affordance from the closure FIRST OPEN occurrence, never a recorded M14 next', async () => {
    // The M14 next workout (1,1) is recorded as not performed; the run's first
    // OPEN authored occurrence is (1,2). The up-next preview must be resolved
    // for the OPEN occurrence — the recorded one must not be offered a Start.
    enrollmentExecute.mockResolvedValue({
      ok: true,
      data: { ...ENROLLED_INCOMPLETE, nextWorkout: { weekNumber: 1, workoutOrder: 1 } },
    });
    scheduleExecute.mockResolvedValue({
      ok: true,
      data: {
        ...scheduleDto(),
        items: [
          {
            scheduledWorkoutId: 'sw-1',
            weekNumber: 1,
            workoutOrder: 1,
            workoutName: 'Upper Body A',
            plannedDate: '2026-09-23',
            status: 'not-performed',
          },
        ],
        focus: { today: null, next: null, pastDue: null },
      },
    });
    resolveNextExecute.mockResolvedValue({
      ...NEXT_DTO,
      weekNumber: 1,
      workoutOrder: 2,
      workoutName: 'Lower Body B',
    });

    const markup = await renderPage();

    // The preview was resolved for the OPEN occurrence (1,2), never the recorded
    // M14 next (1,1).
    expect(resolveNextExecute).toHaveBeenCalledTimes(1);
    expect(resolveNextExecute.mock.calls[0]?.[0]).toMatchObject({
      weekNumber: 1,
      workoutOrder: 2,
    });
    // The panel offers the OPEN occurrence as up next, and the recorded card is
    // stated as recorded (never as up next).
    expect(markup).toContain('UP NEXT · WEEK 1 · WORKOUT 2');
    expect(markup).toContain('Recorded as not performed');
  });

  it('renders a recorded fallback preview with no Start when the closure read is unavailable (M17 final review)', async () => {
    // Degraded closure (null): the page falls back to the M14 next workout
    // (1,2), which here is a RECORDED occurrence. The preview must render the
    // factual recorded state and never a Start/Resume.
    closureExecute.mockResolvedValue({ ok: true, data: null });
    resolveNextExecute.mockResolvedValue({
      ...NEXT_DTO,
      weekNumber: 1,
      workoutOrder: 2,
      sessionState: 'not-performed',
    });

    const markup = await renderPage();

    expect(markup).toContain('Recorded as not performed');
    expect(markup).not.toContain('Start workout');
    expect(markup).not.toContain('Resume workout');
  });

  it('marks a rowless recorded occurrence on its authored card with Undo and no Start', async () => {
    // (1,1) is authored but holds no current planned row; only its recorded fact
    // exists, so the M15 read reports it among the UNPLACED recorded workouts.
    scheduleExecute.mockResolvedValue({
      ok: true,
      data: {
        ...scheduleDto(),
        unplacedNotPerformedWorkouts: [
          {
            scheduledWorkoutId: 'sw-1',
            weekNumber: 1,
            workoutOrder: 1,
            workoutName: 'Upper Body A',
            recordedAtIso: '2026-09-24T18:00:00.000Z',
          },
        ],
      },
    });

    const markup = await renderPage();

    // The rowless fact is stated on the authored card with Undo, its detail link
    // survives and — because the card is recorded — no Start / up-next state is
    // produced for it (no fabricated planned date is needed to suppress it).
    expect(markup).toContain('Recorded as not performed');
    expect(markup).toContain('>Undo<');
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
  });

  it('shows rowless-recorded B as recorded while the later OPEN C is Up next (A/B/C chain)', async () => {
    // Authored A=(1,1) completed, B=(1,2) recorded with NO planned row, C=(1,3)
    // open. The M14 next is B (the first non-completed), which must NOT be shown
    // as up next; the closure's first OPEN authored occurrence is C.
    enrollmentExecute.mockResolvedValue({
      ok: true,
      data: {
        ...ENROLLED_INCOMPLETE,
        completedScheduledWorkoutIds: ['sw-1'],
        nextWorkout: { weekNumber: 1, workoutOrder: 2 },
      },
    });
    scheduleExecute.mockResolvedValue({
      ok: true,
      data: {
        ...scheduleDto(),
        items: [
          {
            scheduledWorkoutId: 'sw-3',
            weekNumber: 1,
            workoutOrder: 3,
            workoutName: 'Conditioning C',
            plannedDate: '2026-09-25',
            status: 'planned',
          },
        ],
        unplacedNotPerformedWorkouts: [
          {
            scheduledWorkoutId: 'sw-2',
            weekNumber: 1,
            workoutOrder: 2,
            workoutName: 'Lower Body B',
            recordedAtIso: '2026-09-24T18:00:00.000Z',
          },
        ],
        focus: { today: null, next: null, pastDue: null },
      },
    });
    closureExecute.mockResolvedValue({
      ok: true,
      data: runClosureDto({
        openInProgramOrder: [
          {
            scheduledWorkoutId: 'sw-3',
            weekNumber: 1,
            workoutOrder: 3,
            workoutName: 'Conditioning C',
          },
        ],
      }),
    });
    resolveNextExecute.mockResolvedValue({
      ...NEXT_DTO,
      weekNumber: 1,
      workoutOrder: 3,
      workoutName: 'Conditioning C',
    });

    const markup = await renderPage();

    // B's rowless record is stated on its authored card, with Undo.
    expect(markup).toContain('Recorded as not performed');
    expect(markup).toContain('>Undo<');
    // C — the first OPEN occurrence — is the resolved up-next / Start target.
    expect(resolveNextExecute.mock.calls[0]?.[0]).toMatchObject({
      weekNumber: 1,
      workoutOrder: 3,
    });
    expect(markup).toContain('UP NEXT · WEEK 1 · WORKOUT 3');
    expect(markup).toContain(
      'href="/programs/fit40-beginner-strength/weeks/1/workouts/3/session"',
    );
  });

  it('degrades a failed run-closure read to a null DTO (logged), never to fabricated counts', async () => {
    closureExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad id', field: 'userId' },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).toContain('Weekly schedule');
      expect(markup).toContain('aria-label="Training schedule"');
      // Still the incomplete M14 surface: a failed closure read never becomes
      // a completion claim.
      expect(markup).not.toContain('View completion summary');
      // Degraded read → no closure truth is invented: the up-next affordance
      // keeps the M14 next workout (1,2).
      expect(resolveNextExecute.mock.calls[0]?.[0]).toMatchObject({
        weekNumber: 1,
        workoutOrder: 2,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('degrades a failed schedule read to no section (logged), never to unconfigured', async () => {
    scheduleExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad id', field: 'userId' },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).not.toContain('aria-label="Training schedule"');
      expect(markup).not.toContain('No training days set yet');
      // The rest of program detail keeps rendering.
      expect(markup).toContain('Weekly schedule');
      expect(markup).toContain('UP NEXT');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('degrades a thrown schedule read the same way (logged, section only)', async () => {
    scheduleExecute.mockRejectedValue(new Error('corrupt planned row'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).not.toContain('aria-label="Training schedule"');
      expect(markup).toContain('Weekly schedule');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('exposes the scheduling mutation affordances for a configured run', async () => {
    const markup = await renderPage();

    expect(markup).toContain('Change training days');
    expect(markup).toContain('Save training days');
    // The fixture's single item is a planned workout dated today: it offers
    // Move, and the date input carries the canonical planned date unchanged.
    expect(markup).toContain('Move workout');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('value="2026-09-23"');
    expect(markup).toContain('New date for Lower Body B');
  });

  it('never renders scheduling mutation controls for a completed run', async () => {
    enrollmentExecute.mockResolvedValue({ ok: true, data: ENROLLED_COMPLETE });

    const markup = await renderPage();

    expect(markup).not.toContain('Set training days');
    expect(markup).not.toContain('Change training days');
    expect(markup).not.toContain('Move workout');
    expect(markup).not.toContain('name="weekday"');
    expect(markup).not.toContain('type="date"');
  });

  it('keeps authored week/workout navigation and hides no EnrollmentId or user id', async () => {
    const markup = await renderPage();

    // Authored public coordinates only — the existing weekly schedule link.
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
    expect(markup).not.toContain('enr-');
    expect(markup).not.toContain(USER_ID);
    expect(markup).toContain('Upper Body A');
  });

  it('renders the follow-through section directly below the M15 week calendar, from one aggregate and one clock', async () => {
    const markup = await renderPage();

    // The read goes through the composed use case, with the authenticated user,
    // the SAME aggregate this page already hydrated, and a server-owned clock.
    expect(followThroughExecute).toHaveBeenCalledTimes(1);
    const input = followThroughExecute.mock.calls[0]?.[0];
    expect(input).toMatchObject({ userId: USER_ID });
    expect(input?.program).toBe(PROGRAM_AGGREGATE);
    expect(input?.now).toBeInstanceOf(Date);
    // No second catalog lookup, and both section reads share that clock.
    expect(programExecute).toHaveBeenCalledTimes(1);
    expect(scheduleExecute.mock.calls[0]?.[0]?.now).toBe(input?.now);

    expect(markup).toContain('This plan so far');
    expect(markup).toContain('last 8 weeks');
    expect(markup).toContain('Sep 21–27');
    expect(markup).toContain('2 of 3 done');
    expect(markup).toContain('1 past due');
    expect(markup).toContain('3 planned · 2 done · 1 completed late · 1 past due');
    expect(markup).toContain(
      'This describes the dates currently on your calendar. Changing your training days replaces them.',
    );

    // Placement: after the M15 calendar section, before the authored weeks.
    const calendarIndex = markup.indexOf('id="training-schedule"');
    const followThroughIndex = markup.indexOf('This plan so far');
    const authoredWeeksIndex = markup.indexOf('Weekly schedule');
    expect(calendarIndex).toBeGreaterThan(-1);
    expect(followThroughIndex).toBeGreaterThan(calendarIndex);
    expect(authoredWeeksIndex).toBeGreaterThan(followThroughIndex);
    // The M15 week calendar is unchanged alongside it.
    expect(markup).toContain('aria-label="Training schedule"');
    expect(markup).toContain('Weeks run Monday–Sunday (UTC).');
    expect(markup).toContain('UP NEXT');
  });

  it('reads an unconfigured run but renders nothing for it (M15 owns setup)', async () => {
    scheduleExecute.mockResolvedValue({ ok: true, data: scheduleDto(false) });
    followThroughExecute.mockResolvedValue({ ok: true, data: followThroughDto(false) });

    const markup = await renderPage();

    // The read happened — absence of a calendar is data, not a failure.
    expect(followThroughExecute).toHaveBeenCalledTimes(1);
    expect(markup).not.toContain('This plan so far');
    expect(markup).not.toContain('No planned dates');
    // The M15 setup surface is the only thing offered for that state.
    expect(markup).toContain('No training days set yet.');
    expect(markup).toContain('Set training days');
    expect(markup).toContain('Weekly schedule');
  });

  it('degrades a failed follow-through read to no section (logged), never to fake data', async () => {
    followThroughExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad id', field: 'userId' },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).not.toContain('This plan so far');
      // Never a fabricated report: no zero totals and no empty-horizon line.
      expect(markup).not.toContain('0 planned');
      expect(markup).not.toContain('No planned dates');
      // The rest of program detail — including the M15 calendar — keeps rendering.
      expect(markup).toContain('aria-label="Training schedule"');
      expect(markup).toContain('Weekly schedule');
      expect(markup).toContain('UP NEXT');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('degrades a thrown follow-through read the same way (logged, section only)', async () => {
    followThroughExecute.mockRejectedValue(new Error('activity store unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).not.toContain('This plan so far');
      expect(markup).toContain('aria-label="Training schedule"');
      expect(markup).toContain('Weekly schedule');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('never renders follow-through rows for another run or from raw repository data', async () => {
    // The page's only follow-through source is the composed use case: with it
    // mocked to claim "not enrolled" the section disappears even though the
    // page-level enrollment says otherwise (a concurrent-leave read), and no
    // repository import is reachable from presentation (module guard above).
    followThroughExecute.mockResolvedValue({ ok: true, data: null });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const markup = await renderPage();

      expect(consoleError).toHaveBeenCalled();
      expect(markup).not.toContain('This plan so far');
      expect(markup).not.toContain('2 of 3 done');
      expect(markup).toContain('Weekly schedule');
    } finally {
      consoleError.mockRestore();
    }
  });
});