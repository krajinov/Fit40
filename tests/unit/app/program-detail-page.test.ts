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
  programExecute,
  resolveNextExecute,
  scheduleExecute,
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
    programExecute: vi.fn(),
    resolveNextExecute: vi.fn(),
    scheduleExecute: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: getCurrentUserMock }));

vi.mock('@/features/enrollment/services', () => ({
  getProgramEnrollmentUseCase: { execute: enrollmentExecute },
}));

vi.mock('@/features/programs/services', () => ({
  getProgramBySlugUseCase: { execute: programExecute },
}));

vi.mock('@/features/sessions/services', () => ({
  resolveNextWorkoutUseCase: { execute: resolveNextExecute },
}));

vi.mock('@/features/schedule/services', () => ({
  getEnrollmentScheduleUseCase: { execute: scheduleExecute },
}));

// The enrollment leaves post to Server Actions that pull the DB composition
// root; stubbed at the module boundary (the program-completed-page pattern).
vi.mock('@/features/enrollment/actions/join-program', () => ({
  joinProgramAction: vi.fn(),
}));
vi.mock('@/features/enrollment/actions/leave-program', () => ({
  leaveProgramAction: vi.fn(),
}));
vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: vi.fn(),
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
  });

  it('never reads or renders a schedule for anonymous visitors', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).toContain('Weekly schedule');
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
  });

  it('never reads or renders a schedule for a signed-in not-enrolled visitor', async () => {
    enrollmentExecute.mockResolvedValue({ ok: true, data: NOT_ENROLLED });

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(markup).not.toContain('aria-label="Training schedule"');
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
    // Slice 6 is read-only: nothing that appears to save exists yet.
    expect(markup).not.toContain('<form');
  });

  it('keeps the M14 completed state authoritative: no schedule read, no section, restart/leave intact', async () => {
    enrollmentExecute.mockResolvedValue({ ok: true, data: ENROLLED_COMPLETE });

    const markup = await renderPage();

    expect(scheduleExecute).not.toHaveBeenCalled();
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('id="training-schedule"');
    // The M14 lifecycle surface stays: summary, restart and leave.
    expect(markup).toContain('View completion summary');
    expect(markup).toContain('Start program again');
    expect(markup).toContain('Leave plan');
    expect(markup).toContain('Program completed — every workout is done.');
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

  it('keeps authored week/workout navigation and hides no EnrollmentId or user id', async () => {
    const markup = await renderPage();

    // Authored public coordinates only — the existing weekly schedule link.
    expect(markup).toContain('href="/programs/fit40-beginner-strength/weeks/1/workouts/1"');
    expect(markup).not.toContain('enr-');
    expect(markup).not.toContain(USER_ID);
    expect(markup).toContain('Upper Body A');
  });
});