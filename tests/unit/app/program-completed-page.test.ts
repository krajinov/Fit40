/**
 * Route-contract tests for /programs/[programSlug]/completed (M14 Slice 6).
 *
 * The repository has no separate page-test architecture, so the page is
 * exercised as the async Server Component function it is, using the same
 * module-mock style as the Server Action tests: navigation helpers throw
 * sentinel errors, and the auth/composition layers are mocked. Pinned:
 * completed renders, not-enrolled and incomplete redirect to program
 * detail, invalid/unknown slugs are notFound, and unexpected failures throw
 * to the error boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { notFoundMock, redirectMock, requireUserMock, summaryExecuteMock } = vi.hoisted(() => {
  const notFound = vi.fn(() => {
    const error = new Error('NEXT_NOT_FOUND');
    error.name = 'NEXT_NOT_FOUND';
    throw error;
  });
  const redirect = vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  });

  return {
    notFoundMock: notFound,
    redirectMock: redirect,
    requireUserMock: vi.fn(),
    summaryExecuteMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));

vi.mock('@/features/auth/current-user', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/features/enrollment/services', () => ({
  getProgramCompletionSummaryUseCase: { execute: summaryExecuteMock },
}));

// The summary component embeds the restart leaf, which imports the action
// module (DB composition root); this test asserts the route contract only.
vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: vi.fn(),
}));

import ProgramCompletedPage from '@/app/(app)/programs/[programSlug]/completed/page';
import type { ProgramCompletionSummaryDto } from '@/application/dto/program-completion';

const SESSION_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SLUG = 'fit40-beginner-strength';
const PROGRAM_PATH = `/programs/${SLUG}`;
const COMPLETED_PATH = `/programs/${SLUG}/completed`;

function renderPage(programSlug: string = SLUG) {
  return ProgramCompletedPage({ params: Promise.resolve({ programSlug }) });
}

const COMPLETED_SUMMARY: ProgramCompletionSummaryDto = {
  status: 'completed',
  programName: 'Fit40 Beginner Strength',
  programSlug: SLUG,
  completedWorkouts: 12,
  totalWorkouts: 12,
  completedAt: '2026-02-15T10:30:00.000Z',
  distinctExercises: 7,
  recordEventCount: 2,
  recordEvents: [
    {
      exerciseId: 'ex-1',
      exerciseName: 'Goblet Squat',
      exerciseSlug: 'goblet-squat',
      metric: 'max-load',
      value: 82.5,
      previousBest: 80,
      sessionId: 'session-1',
      completedAt: '2026-02-10T18:00:00.000Z',
    },
    {
      exerciseId: 'ex-2',
      exerciseName: 'Push-up',
      exerciseSlug: 'push-up',
      metric: 'max-bodyweight-reps',
      value: 18,
      previousBest: null,
      sessionId: 'session-2',
      completedAt: '2026-02-12T18:00:00.000Z',
    },
  ],
};

describe('/programs/[programSlug]/completed page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
  });

  it('maps an invalid slug to notFound before touching auth or the use case', async () => {
    await expect(renderPage('Not A Slug!')).rejects.toThrow('NEXT_NOT_FOUND');

    expect(requireUserMock).not.toHaveBeenCalled();
    expect(summaryExecuteMock).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated visitors to login with a deep link back to the page', async () => {
    requireUserMock.mockImplementation(() =>
      redirectMock(`/login?next=${encodeURIComponent(COMPLETED_PATH)}`),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirectMock).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(COMPLETED_PATH)}`,
    );
    expect(summaryExecuteMock).not.toHaveBeenCalled();
  });

  it('maps an unknown program to notFound, matching program detail semantics', async () => {
    summaryExecuteMock.mockResolvedValue({
      ok: false,
      error: { code: 'PROGRAM_NOT_FOUND', slug: SLUG, message: `Program "${SLUG}" not found` },
    });

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(summaryExecuteMock).toHaveBeenCalledWith({
      userId: SESSION_USER.id,
      programSlug: SLUG,
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects a not-enrolled user to the program detail page', async () => {
    summaryExecuteMock.mockResolvedValue({ ok: true, data: null });

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${PROGRAM_PATH}`);

    expect(redirectMock).toHaveBeenCalledWith(PROGRAM_PATH);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('redirects an incomplete run to the program detail page', async () => {
    summaryExecuteMock.mockResolvedValue({
      ok: true,
      data: { status: 'incomplete', completedWorkouts: 3, totalWorkouts: 12 },
    });

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:${PROGRAM_PATH}`);

    expect(redirectMock).toHaveBeenCalledWith(PROGRAM_PATH);
  });

  it('renders the completion summary for a completed run', async () => {
    summaryExecuteMock.mockResolvedValue({ ok: true, data: COMPLETED_SUMMARY });

    const element = await renderPage();
    const markup = renderToStaticMarkup(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(markup).toContain('Program completed');
    expect(markup).toContain('Fit40 Beginner Strength');
    expect(markup).toContain('12 of 12');
    expect(markup).toContain('Feb 15, 2026');
    expect(markup).toContain('Personal records during this program');
    expect(markup).toContain('Start program again');
    expect(markup).toContain('Choose another program');
    expect(markup).toContain('href="/programs"');
    expect(markup).toContain('href="/history/sessions/session-1"');
  });

  it('lets unexpected application failures throw to the error boundary', async () => {
    summaryExecuteMock.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Invalid user id.', field: 'userId' },
    });

    await expect(renderPage()).rejects.toThrow(
      `Failed to resolve program completion for "${SLUG}"`,
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
