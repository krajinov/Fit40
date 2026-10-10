/**
 * Route-contract tests for /progress (M18 Slice 4, extended by Slice 6).
 *
 * The repository has no separate page-test architecture, so the page is
 * exercised as the async Server Component function it is (the dashboard-page
 * pattern): auth and the two view assemblies are mocked, and the rendered markup
 * is inspected with renderToStaticMarkup. Pinned: the /progress redirect target,
 * exactly one request clock handed to BOTH reads, the heading, and the truthful
 * degraded copy of each half. Week/metric DATA itself is proven in
 * progress-view.test.ts and the timeline mapping in
 * personal-best-timeline-view.test.ts; nav/source guards belong to Slice 9.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { redirectMock, requireUserMock, buildViewMock, buildTimelineMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  }),
  requireUserMock: vi.fn(),
  buildViewMock: vi.fn(),
  buildTimelineMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/features/auth/current-user', () => ({ requireUser: requireUserMock }));
vi.mock('@/features/progress/progress-view', () => ({ buildProgressView: buildViewMock }));
vi.mock('@/features/progress/personal-best-timeline-view', () => ({
  buildProgressRecordTimeline: buildTimelineMock,
}));

import ProgressPage from '@/app/(app)/progress/page';
import {
  PERSONAL_BESTS_TIMELINE_TITLE,
  PROGRESS_HEADING,
  PROGRESS_SUBHEADING,
  UNAVAILABLE_ACTIVITY_MESSAGE,
} from '@/features/progress/progress-labels';

const SESSION_USER = {
  id: 'user-progress-1',
  email: 'progress@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

describe('/progress page (M18 Slice 4 + Slice 6)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    buildViewMock.mockResolvedValue({ status: 'unavailable' });
    buildTimelineMock.mockResolvedValue({ status: 'unavailable' });
  });

  it('requires the session against /progress and renders the heading', async () => {
    const element = await ProgressPage();
    const markup = renderToStaticMarkup(element);

    expect(requireUserMock).toHaveBeenCalledWith('/progress');
    expect(markup).toContain(PROGRESS_HEADING);
    expect(markup).toContain(PROGRESS_SUBHEADING);
  });

  it('hands ONE request clock to both independent reads', async () => {
    await ProgressPage();

    expect(buildViewMock).toHaveBeenCalledTimes(1);
    expect(buildTimelineMock).toHaveBeenCalledTimes(1);
    const viewCall = buildViewMock.mock.calls[0];
    const timelineCall = buildTimelineMock.mock.calls[0];
    expect(viewCall?.[0]).toBe(SESSION_USER.id);
    expect(timelineCall?.[0]).toBe(SESSION_USER.id);
    expect(viewCall?.[1]).toBeInstanceOf(Date);
    // The same instant for both, so the whole request describes one clock.
    expect(timelineCall?.[1]).toBe(viewCall?.[1]);
  });

  it('renders the truthful degraded copy when the reads are unavailable', async () => {
    const element = await ProgressPage();
    const markup = renderToStaticMarkup(element);

    // `renderToStaticMarkup` HTML-escapes the apostrophe in "Couldn't", so the
    // assertion uses the apostrophe-free fragment (the real copy is pinned in
    // progress-screen.test.ts, which reads decoded text).
    expect(UNAVAILABLE_ACTIVITY_MESSAGE).toContain('load your training activity.');
    expect(markup).toContain('load your training activity.');
    expect(markup).toContain('load your external load.');
    expect(markup).toContain('load your period summary.');
    expect(markup).toContain('load your personal bests.');
    // A failed read never renders fabricated zero weeks or a personal-best count.
    expect(markup).not.toContain('0 workouts');
    expect(markup).not.toContain('personal bests set in the last 13 weeks');
  });

  it('keeps the activity degraded copy while the timeline renders its rows', async () => {
    buildTimelineMock.mockResolvedValue({
      status: 'loaded',
      data: {
        title: PERSONAL_BESTS_TIMELINE_TITLE,
        caption: 'Historical events: not necessarily your current best.',
        recordEventCount: 2,
        countCaption: '2 personal bests set in the last 13 weeks.',
        events: [],
        capNote: null,
        emptyState: null,
        unresolvedNote: null,
        summaryFragment: '2 personal bests',
      },
    });

    const element = await ProgressPage();
    const markup = renderToStaticMarkup(element);

    // The timeline is independent of the activity read: it still renders.
    expect(markup).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
    expect(markup).toContain('2 personal bests set in the last 13 weeks.');
    expect(markup).toContain('load your training activity.');
  });

  it('redirects an unauthenticated visitor instead of rendering anything', async () => {
    requireUserMock.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT:/login');
    });

    await expect(ProgressPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(buildViewMock).not.toHaveBeenCalled();
    expect(buildTimelineMock).not.toHaveBeenCalled();
  });
});
