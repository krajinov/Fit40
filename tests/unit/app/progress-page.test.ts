/**
 * Route-contract tests for /progress (M18 Slice 4).
 *
 * The repository has no separate page-test architecture, so the page is
 * exercised as the async Server Component function it is (the dashboard-page
 * pattern): auth and the view assembly are mocked, and the rendered markup is
 * inspected with renderToStaticMarkup. Pinned: the /progress redirect target,
 * exactly one request clock handed to the view assembly, the heading, and the
 * truthful degraded copy. Week/metric DATA itself is proven in
 * progress-view.test.ts, and nav/source guards belong to Slice 9.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { redirectMock, requireUserMock, buildViewMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => {
    const error = new Error(`NEXT_REDIRECT:${target}`);
    error.name = 'NEXT_REDIRECT';
    throw error;
  }),
  requireUserMock: vi.fn(),
  buildViewMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/features/auth/current-user', () => ({ requireUser: requireUserMock }));
vi.mock('@/features/progress/progress-view', () => ({ buildProgressView: buildViewMock }));

import ProgressPage from '@/app/(app)/progress/page';
import {
  PROGRESS_HEADING,
  PROGRESS_SUBHEADING,
  UNAVAILABLE_ACTIVITY_MESSAGE,
} from '@/features/progress/progress-labels';

const SESSION_USER = {
  id: 'user-progress-1',
  email: 'progress@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

describe('/progress page (M18 Slice 4)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireUserMock.mockResolvedValue(SESSION_USER);
    buildViewMock.mockResolvedValue({ status: 'unavailable' });
  });

  it('requires the session against /progress and renders the heading', async () => {
    const element = await ProgressPage();
    const markup = renderToStaticMarkup(element);

    expect(requireUserMock).toHaveBeenCalledWith('/progress');
    expect(markup).toContain(PROGRESS_HEADING);
    expect(markup).toContain(PROGRESS_SUBHEADING);
  });

  it('passes exactly one request clock to the view assembly', async () => {
    await ProgressPage();

    expect(buildViewMock).toHaveBeenCalledTimes(1);
    const call = buildViewMock.mock.calls[0];
    expect(call?.[0]).toBe(SESSION_USER.id);
    expect(call?.[1]).toBeInstanceOf(Date);
  });

  it('renders the truthful degraded copy when the read is unavailable', async () => {
    const element = await ProgressPage();
    const markup = renderToStaticMarkup(element);

    // `renderToStaticMarkup` HTML-escapes the apostrophe in "Couldn't", so the
    // assertion uses the apostrophe-free fragment (the real copy is pinned in
    // progress-screen.test.ts, which reads decoded text).
    expect(UNAVAILABLE_ACTIVITY_MESSAGE).toContain('load your training activity.');
    expect(markup).toContain('load your training activity.');
    expect(markup).toContain('load your external load.');
    expect(markup).toContain('load your period summary.');
    // A failed read never renders fabricated zero weeks.
    expect(markup).not.toContain('0 workouts');
  });

  it('redirects an unauthenticated visitor instead of rendering anything', async () => {
    requireUserMock.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT:/login');
    });

    await expect(ProgressPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(buildViewMock).not.toHaveBeenCalled();
  });
});
