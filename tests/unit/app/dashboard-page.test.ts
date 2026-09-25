/**
 * Route-contract tests for /dashboard with the M15 schedule section (Slice 5).
 *
 * The repository has no separate page-test architecture, so the page is
 * exercised as the async Server Component function it is (the
 * program-completed-page pattern): auth and the view assembly are mocked, and
 * the rendered markup is inspected with renderToStaticMarkup. Pinned: no
 * enrollment means no scheduling section, an active run shows it (Today and
 * the setup CTA), a completed run renders the M14 card instead of any
 * next-workout affordance, M13 insights and recent training still render, and
 * no EnrollmentId reaches the DOM. Schedule DATA itself is proven to come
 * through GetEnrollmentScheduleUseCase in dashboard-view.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { redirect: redirectMock, requireUserMock, profileExecuteMock, buildViewMock } =
  vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  }),
  requireUserMock: vi.fn(),
  profileExecuteMock: vi.fn(),
  buildViewMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/features/auth/current-user', () => ({ requireUser: requireUserMock }));

vi.mock('@/features/profile/services', () => ({
  getUserProfileUseCase: { execute: profileExecuteMock },
}));

vi.mock('@/features/dashboard/dashboard-view', () => ({
  buildDashboardView: buildViewMock,
}));

import DashboardPage from '@/app/(app)/dashboard/page';
import type { DashboardView } from '@/features/dashboard/dashboard-view';
import type { DashboardScheduleState } from '@/application/dto/dashboard';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROFILE = {
  userId: SESSION_USER.id,
  birthYear: 1985,
  experienceLevel: 'beginner',
  primaryGoal: 'strength',
  availableEquipment: ['dumbbell'],
  physicalConsiderations: [],
  preferredDaysPerWeek: 3,
  preferredSessionMinutes: 45,
  heightCm: 178,
  weightKg: 80,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const LOADED_INSIGHTS = {
  status: 'loaded',
  data: {
    weekLabel: 'Week of Feb 16',
    stats: [{ label: 'Workouts', value: '3' }],
    comparisonLabel: '1 more than last week',
    activityCaption: 'Workouts per week',
    activityWeeks: [],
    personalBestsCaption: 'Personal bests',
    personalBests: [],
  },
} as const;

const RECENT_TRAINING = {
  status: 'loaded',
  sessions: [
    {
      sessionId: 'session-abc',
      workoutName: 'Full Body A',
      programName: 'Fit40 Beginner Strength',
      durationLabel: '42 min',
      completedAtLabel: 'Feb 17, 2026',
      setsLabel: '18 sets',
    },
  ],
} as const;

const PROGRAM_DETAIL = {
  id: 'p1',
  name: 'Fit40 Beginner Strength',
  slug: 'fit40-beginner-strength',
  description: 'A program.',
  difficulty: 'beginner',
  goal: 'strength',
  durationWeeks: 4,
  workoutsPerWeek: 3,
  weeks: [],
} as const;

const ENROLLED = {
  status: 'enrolled',
  enrolledAt: '2026-01-01T10:00:00.000Z',
  progress: { totalWorkouts: 12, completedWorkouts: 3, percentage: 25 },
  nextWorkout: { weekNumber: 1, workoutOrder: 4 },
  completedScheduledWorkoutIds: [],
} as const;

const NEXT_PREVIEW = {
  status: 'available',
  workout: {
    programSlug: 'fit40-beginner-strength',
    weekNumber: 1,
    workoutOrder: 4,
    workoutName: 'Upper Body A',
    exerciseCount: 4,
    estimatedMinutes: 40,
    preview: [],
    sessionState: 'not-started',
  },
} as const;

function configuredSchedule(): DashboardScheduleState {
  const item = {
    scheduledWorkoutId: 'sw-1',
    weekNumber: 1,
    workoutOrder: 4,
    workoutName: 'Upper Body A',
    plannedDate: '2026-02-18',
    status: 'planned',
  } as const;
  return {
    status: 'loaded',
    schedule: {
      programSlug: 'fit40-beginner-strength',
      configured: true,
      today: '2026-02-18',
      items: [item],
      focus: { today: item, next: null, pastDue: null },
    },
  };
}

function view(currentProgram: DashboardView['currentProgram']): DashboardView {
  return {
    profile: PROFILE,
    currentProgram,
    recentTraining: RECENT_TRAINING,
    weeklyInsights: LOADED_INSIGHTS,
    weekSummaries: [],
  };
}

async function renderPage(currentProgram: DashboardView['currentProgram']): Promise<string> {
  buildViewMock.mockResolvedValue(view(currentProgram));
  const element = await DashboardPage();
  return renderToStaticMarkup(element);
}

function activeProgram(schedule: DashboardScheduleState): NonNullable<
  DashboardView['currentProgram']
> {
  return {
    program: PROGRAM_DETAIL,
    enrollment: ENROLLED,
    nextWorkoutPreview: NEXT_PREVIEW,
    schedule,
  };
}

describe('/dashboard page (M15 Slice 5)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    profileExecuteMock.mockResolvedValue(PROFILE);
  });

  it('renders no scheduling section when the user has no current program', async () => {
    const markup = await renderPage(null);

    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('Set training days');
    expect(markup).toContain('No program yet');
    // Insights are user-global and keep rendering without an enrollment.
    expect(markup).toContain('This week');
    expect(markup).toContain('Recent training');
  });

  it('renders the schedule section for an active run with Today and its session link', async () => {
    const markup = await renderPage(activeProgram(configuredSchedule()));

    expect(markup).toContain('aria-label="Training schedule"');
    expect(markup).toContain('TODAY');
    expect(markup).toContain('Upper Body A');
    expect(markup).toContain(
      'href="/programs/fit40-beginner-strength/weeks/1/workouts/4/session"',
    );
    // The existing Up-next card is preserved alongside it (additive only).
    expect(markup).toContain('aria-label="Up next"');
  });

  it('renders the setup prompt for an unconfigured run, pointing at an existing route', async () => {
    const unconfigured: DashboardScheduleState = {
      status: 'loaded',
      schedule: {
        programSlug: 'fit40-beginner-strength',
        configured: false,
        today: '2026-02-18',
        items: [],
        focus: { today: null, next: null, pastDue: null },
      },
    };
    const markup = await renderPage(activeProgram(unconfigured));

    expect(markup).toContain('Set training days');
    expect(markup).toContain('href="/programs/fit40-beginner-strength"');
    // The schedule card itself adds no Start/Resume CTA in this state —
    // pinned in isolation by training-schedule-card.test.ts (the page also
    // renders the preserved Up-next card, which has its own Start button).
    expect(markup).toContain('aria-label="Training schedule"');
    expect(markup).toContain('Choose your training days to put this program on your calendar.');
  });

  it('keeps the M14 completed card authoritative — no schedule section or next-workout CTA', async () => {
    const completed: DashboardView['currentProgram'] = {
      program: PROGRAM_DETAIL,
      enrollment: { ...ENROLLED, nextWorkout: null, progress: { totalWorkouts: 12, completedWorkouts: 12, percentage: 100 } },
      nextWorkoutPreview: { status: 'complete' },
      // Even a configured schedule must not appear against a completed run.
      schedule: configuredSchedule(),
    };
    const markup = await renderPage(completed);

    expect(markup).toContain('Program completed');
    expect(markup).toContain('href="/programs/fit40-beginner-strength/completed"');
    expect(markup).not.toContain('aria-label="Training schedule"');
    expect(markup).not.toContain('Start workout');
    expect(markup).not.toContain('Resume workout');
    expect(markup).not.toContain('TODAY');
  });

  it('keeps M13 weekly insights and recent training rendering', async () => {
    const markup = await renderPage(activeProgram(configuredSchedule()));

    expect(markup).toContain('This week');
    expect(markup).toContain('Workouts');
    expect(markup).toContain('Recent training');
    expect(markup).toContain('Full Body A');
  });

  it('exposes no EnrollmentId anywhere in the rendered markup', async () => {
    const markup = await renderPage(activeProgram(configuredSchedule()));

    expect(markup).not.toContain('enr-');
    expect(markup).not.toContain(SESSION_USER.id);
  });
});
