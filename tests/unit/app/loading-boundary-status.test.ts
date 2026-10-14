/**
 * M19 S2 review fix (PR #25, four P2 threads) — behavioral status contracts.
 *
 * A segment `loading.tsx` flushes HTTP 200 before the page's own
 * redirect()/notFound() can run (probe-verified on next@16.3.1), which turned
 * signed-out private requests into 200 + meta-refresh and /programs/unknown
 * into 200 instead of 404. The fix moves every status-critical await BEFORE
 * the page returns JSX and streams only success-path content behind an
 * explicit Suspense boundary.
 *
 * These tests pin that ordering by calling the REAL async page functions with
 * mocked services:
 * - an auth failure REJECTS the page promise before any JSX exists (with no
 *   boundary in the route chain, the framework's native 307 follows);
 * - a not-found failure REJECTS before any JSX exists (native 404);
 * - an authenticated success RETURNS a Suspense boundary whose fallback is the
 *   shared placeholder (useful loading feedback preserved).
 *
 * The native-status outcomes themselves are verified against the production
 * runtime by HTTP probes (recorded in docs/milestones/milestone-19-s2-report.md).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const {
  notFoundMock,
  redirectMock,
  requireUserMock,
  getCurrentUserMock,
  profileExecuteMock,
  dashboardViewMock,
  progressViewMock,
  progressTimelineMock,
  historyViewMock,
  exerciseHistoryViewMock,
  programExecuteMock,
  lookupWorkoutMock,
  activeWorkoutViewMock,
} = vi.hoisted(() => {
  const notFound = vi.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    error.name = 'NEXT_NOT_FOUND';
    throw error;
  });
  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT: ${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });
  const authError = () => {
    const error = new Error('NEXT_REDIRECT: /login');
    error.name = 'NEXT_REDIRECT';
    return error;
  };
  return {
    notFoundMock: notFound,
    redirectMock: redirect,
    requireUserMock: vi.fn(async (): Promise<unknown> => {
      throw authError();
    }),
    getCurrentUserMock: vi.fn(async (): Promise<unknown> => null),
    profileExecuteMock: vi.fn(),
    dashboardViewMock: vi.fn(),
    progressViewMock: vi.fn(),
    progressTimelineMock: vi.fn(),
    historyViewMock: vi.fn(),
    exerciseHistoryViewMock: vi.fn(),
    programExecuteMock: vi.fn(),
    lookupWorkoutMock: vi.fn(),
    activeWorkoutViewMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@/features/profile/services', () => ({
  getUserProfileUseCase: { execute: profileExecuteMock },
}));
vi.mock('@/features/dashboard/dashboard-view', () => ({
  buildDashboardView: dashboardViewMock,
}));
vi.mock('@/features/progress/progress-view', () => ({
  buildProgressView: progressViewMock,
}));
vi.mock('@/features/progress/personal-best-timeline-view', () => ({
  buildProgressRecordTimeline: progressTimelineMock,
}));
vi.mock('@/features/history/history-view', () => ({
  buildHistoryView: historyViewMock,
}));
vi.mock('@/features/history/exercise-history-view', () => ({
  buildExerciseHistoryView: exerciseHistoryViewMock,
}));
vi.mock('@/features/programs/services', () => ({
  getProgramBySlugUseCase: { execute: programExecuteMock },
}));
vi.mock('@/features/programs/scheduled-workout-lookup', () => ({
  lookupScheduledWorkout: lookupWorkoutMock,
}));
vi.mock('@/features/sessions/active-workout-view', () => ({
  buildActiveWorkoutView: activeWorkoutViewMock,
}));

// The pages' slow paths import composed use cases that pull the DB composition
// root; stub every consumed export so no repository module ever loads, and
// fail loudly if a page import ever changes.
vi.mock('@/features/enrollment/services', () => ({
  getProgramEnrollmentUseCase: { execute: vi.fn() },
  getRunClosureSummaryUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/schedule/services', () => ({
  getEnrollmentScheduleUseCase: { execute: vi.fn() },
  getEnrollmentFollowThroughUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/sessions/next-workout-view', () => ({
  buildNextWorkoutView: vi.fn(),
  nextWorkoutPreviewState: vi.fn(),
}));
vi.mock('@/features/enrollment/next-occurrence', () => ({
  resolveRunNextOccurrence: vi.fn(),
}));

// The session panels and join/leave surfaces import Server Actions whose
// modules reach the DB composition root at import time; stub every action the
// imported components consume (the program-detail-page test convention).
vi.mock('@/features/enrollment/actions/join-program', () => ({ joinProgramAction: vi.fn() }));
vi.mock('@/features/enrollment/actions/leave-program', () => ({ leaveProgramAction: vi.fn() }));
vi.mock('@/features/enrollment/actions/restart-program', () => ({ restartProgramAction: vi.fn() }));
vi.mock('@/features/sessions/actions/add-exercise', () => ({ addExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/complete-session', () => ({ completeSessionAction: vi.fn() }));
vi.mock('@/features/sessions/actions/delete-set', () => ({ deleteSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/log-set', () => ({ logSetAction: vi.fn() }));
vi.mock('@/features/sessions/actions/move-exercise', () => ({ moveExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/remove-exercise', () => ({ removeExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/restore-exercise', () => ({ restoreExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/skip-exercise', () => ({ skipExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/start-session', () => ({ startSessionAction: vi.fn() }));
vi.mock('@/features/sessions/actions/substitute-exercise', () => ({
  substituteExerciseAction: vi.fn(),
}));
vi.mock('@/features/sessions/actions/unskip-exercise', () => ({ unskipExerciseAction: vi.fn() }));
vi.mock('@/features/sessions/actions/update-set', () => ({ updateSetAction: vi.fn() }));
import DashboardPage from '@/app/(app)/dashboard/page';
import ProgressPage from '@/app/(app)/progress/page';
import HistoryPage from '@/app/(app)/history/page';
import ExerciseHistoryPage from '@/app/(app)/history/exercises/[slug]/page';
import ProgramDetailPage from '@/app/(app)/programs/[programSlug]/page';
import SessionPage from '@/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/page';

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

/** A promise that never settles — keeps the streamed content pending. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Asserts the element is the page's Suspense boundary and returns fallback. */
function suspenseFallbackOf(element: unknown): ReactNode {
  expect(isValidElement(element)).toBe(true);
  const el = element as ReactElement<{ fallback?: ReactNode }>;
  expect(el.type).toBe(Suspense);
  return el.props.fallback;
}

function fallbackMarkup(fallback: ReactNode): string {
  return renderToStaticMarkup(fallback ?? null);
}

function readableText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('/dashboard — auth and profile steering precede any streamed fallback', () => {
  it('rejects with the login redirect before any JSX exists', async () => {
    requireUserMock.mockRejectedValue(new Error('auth'));

    await expect(DashboardPage()).rejects.toThrow('auth');
    expect(profileExecuteMock).not.toHaveBeenCalled();
    expect(dashboardViewMock).not.toHaveBeenCalled();
  });

  it('rejects with the onboarding redirect before the view starts', async () => {
    requireUserMock.mockResolvedValue(USER);
    profileExecuteMock.mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/onboarding');
    expect(dashboardViewMock).not.toHaveBeenCalled();
  });

  it('streams the shared placeholder behind Suspense once authenticated', async () => {
    requireUserMock.mockResolvedValue(USER);
    profileExecuteMock.mockResolvedValue({ userId: USER.id });
    dashboardViewMock.mockReturnValue(pending());

    const element = await DashboardPage();
    const html = fallbackMarkup(suspenseFallbackOf(element));

    expect(html).toContain('Loading your training');
    expect(html.match(/role="status"/g) ?? []).toHaveLength(1);
    expect(html.match(/aria-hidden="true"/g) ?? []).not.toHaveLength(0);
    expect(readableText(html)).not.toMatch(/\d/);
  });
});

describe('/progress — auth precedes any streamed fallback', () => {
  it('rejects with the login redirect before any read starts', async () => {
    requireUserMock.mockRejectedValue(new Error('auth'));

    await expect(ProgressPage()).rejects.toThrow('auth');
    expect(progressViewMock).not.toHaveBeenCalled();
    expect(progressTimelineMock).not.toHaveBeenCalled();
  });

  it('streams the shared placeholder behind Suspense once authenticated', async () => {
    requireUserMock.mockResolvedValue(USER);
    progressViewMock.mockReturnValue(pending());
    progressTimelineMock.mockReturnValue(pending());

    const element = await ProgressPage();
    const html = fallbackMarkup(suspenseFallbackOf(element));

    expect(html).toContain('Loading progress');
    expect(readableText(html)).not.toMatch(/\d/);
  });
});

describe('/history — auth precedes streaming; tampered cursors stay native 404', () => {
  it('rejects with the login redirect before any read starts', async () => {
    requireUserMock.mockRejectedValue(new Error('auth'));

    await expect(
      HistoryPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('auth');
    expect(historyViewMock).not.toHaveBeenCalled();
  });

  it('rejects with notFound for a tampered cursor before any JSX exists', async () => {
    requireUserMock.mockResolvedValue(USER);
    historyViewMock.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'stale cursor' },
    });

    await expect(
      HistoryPage({ searchParams: Promise.resolve({ cursor: 'tampered' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('streams the shared placeholder behind Suspense for the first page', async () => {
    requireUserMock.mockResolvedValue(USER);
    historyViewMock.mockReturnValue(pending());

    const element = await HistoryPage({ searchParams: Promise.resolve({}) });
    const html = fallbackMarkup(suspenseFallbackOf(element));

    expect(html).toContain('Loading training history');
    expect(readableText(html)).not.toMatch(/\d/);
  });

  it('renders paginated content directly with no boundary once resolved', async () => {
    requireUserMock.mockResolvedValue(USER);
    historyViewMock.mockResolvedValue({
      ok: true,
      data: {
        totals: { completedWorkouts: '0', loggedSets: '0' },
        sessions: [],
        exerciseShortcuts: [],
        olderPageHref: null,
      },
    });

    const element = await HistoryPage({
      searchParams: Promise.resolve({ cursor: 'valid-token' }),
    });
    expect(isValidElement(element) && (element as ReactElement).type).not.toBe(
      Suspense,
    );
  });
});


describe('/history/exercises/[slug] — validation, auth and existence all pre-stream', () => {
  it('rejects with notFound for a malformed slug without consulting auth', async () => {
    await expect(
      ExerciseHistoryPage({ params: Promise.resolve({ slug: 'Bad_Slug!' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(exerciseHistoryViewMock).not.toHaveBeenCalled();
  });

  it('rejects with the login redirect before any view read', async () => {
    requireUserMock.mockRejectedValue(new Error('auth'));

    await expect(
      ExerciseHistoryPage({ params: Promise.resolve({ slug: 'goblet-squat' }) }),
    ).rejects.toThrow('auth');
    expect(exerciseHistoryViewMock).not.toHaveBeenCalled();
  });

  it('rejects with notFound for an unknown exercise before any JSX exists', async () => {
    requireUserMock.mockResolvedValue(USER);
    exerciseHistoryViewMock.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', message: 'unknown slug' },
    });

    await expect(
      ExerciseHistoryPage({ params: Promise.resolve({ slug: 'unknown-move' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('returns boundary-free JSX for a known exercise (no Suspense to flush)', async () => {
    requireUserMock.mockResolvedValue(USER);
    exerciseHistoryViewMock.mockResolvedValue({
      ok: true,
      data: { heading: 'Goblet squat', entries: [] },
    });

    const element = await ExerciseHistoryPage({
      params: Promise.resolve({ slug: 'goblet-squat' }),
    });
    expect(isValidElement(element) && (element as ReactElement).type).not.toBe(
      Suspense,
    );
    expect(requireUserMock).toHaveBeenCalledWith('/history/exercises/goblet-squat');
  });
});

describe('/programs/[programSlug] — existence validation precedes streaming (public route)', () => {
  it('rejects with notFound for a malformed slug before any lookup', async () => {
    await expect(
      ProgramDetailPage({ params: Promise.resolve({ programSlug: 'Bad Slug!' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(programExecuteMock).not.toHaveBeenCalled();
  });

  it('rejects with notFound for an unknown program before any JSX exists', async () => {
    programExecuteMock.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'unknown' },
    });

    await expect(
      ProgramDetailPage({ params: Promise.resolve({ programSlug: 'unknown' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    // The page stays public: no authentication happens before validation.
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('streams the shared placeholder behind Suspense for a known program', async () => {
    programExecuteMock.mockResolvedValue({
      ok: true,
      data: { program: { id: 'p1', slug: 'fit40-beginner-strength' }, detail: {} },
    });

    const element = await ProgramDetailPage({
      params: Promise.resolve({ programSlug: 'fit40-beginner-strength' }),
    });
    const html = fallbackMarkup(suspenseFallbackOf(element));

    expect(html).toContain('Loading program details');
    expect(readableText(html)).not.toMatch(/\d/);
    // Personalized reads belong to the streamed success path only.
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });
});

const sessionParams = (weekNumber: string) => ({
  programSlug: 'fit40-beginner-strength',
  weekNumber,
  workoutOrder: '1',
});

describe('session route — validation, auth and existence all pre-stream', () => {
  it('rejects with notFound for malformed params before consulting auth', async () => {
    await expect(SessionPage({ params: Promise.resolve(sessionParams('abc')) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it('rejects with the login redirect before any lookup', async () => {
    requireUserMock.mockRejectedValue(new Error('auth'));

    await expect(SessionPage({ params: Promise.resolve(sessionParams('1')) })).rejects.toThrow(
      'auth',
    );
    expect(lookupWorkoutMock).not.toHaveBeenCalled();
  });

  it('rejects with notFound for an unknown occurrence before any JSX exists', async () => {
    requireUserMock.mockResolvedValue(USER);
    lookupWorkoutMock.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });

    await expect(SessionPage({ params: Promise.resolve(sessionParams('99')) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(activeWorkoutViewMock).not.toHaveBeenCalled();
  });

  it('streams the shared placeholder behind Suspense once authenticated', async () => {
    requireUserMock.mockResolvedValue(USER);
    lookupWorkoutMock.mockResolvedValue({
      ok: true,
      data: { workout: { name: 'Upper Body A' } },
    });
    activeWorkoutViewMock.mockReturnValue(pending());

    const element = await SessionPage({ params: Promise.resolve(sessionParams('1')) });
    const html = fallbackMarkup(suspenseFallbackOf(element));

    expect(html).toContain('Loading workout session');
    // The session frame carries no bottom bar of its own.
    expect(html).not.toContain('aria-label="Primary"');
    expect(readableText(html)).not.toMatch(/\d/);
  });
});
