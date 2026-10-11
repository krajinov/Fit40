// @vitest-environment jsdom
/**
 * M19 S1 — HONEST framework-integration recovery harness (P1) + single-main
 * composition guard (P2).
 *
 * WHY THIS FILE EXISTS (and differs from error-state.test.ts):
 * error-state.test.ts proves the button *delegates* to the injected `retry`
 * prop. That alone does NOT prove a fresh Server Component response — a mocked
 * `retry` proves nothing about the framework. This file instead drives the
 * REAL Next.js `ErrorBoundaryHandler` (the class behind every route-group
 * `error.tsx`) with a REAL `AppRouterContext`, so the `retry` handed to our
 * boundary is the framework's own implementation. We then observe that real
 * `retry()` reaches `context.refresh()` — verified in next@16.3.1 to run
 * `startTransition(() => { context.refresh(); reset(); })`, where `refresh()`
 * fetches a FRESH Server Component response and `reset()` alone only clears
 * boundary state. Only the router context (production: the App Router) and the
 * simulated server-health are under test control; the retry path itself is
 * framework code we neither reimplement nor mock.
 */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ErrorBoundaryHandler,
  type ErrorInfo,
} from 'next/dist/client/components/error-boundary';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

// The (app) layout is an async Server Component that resolves the session; the
// single-main composition test renders the REAL layout, so identity resolution
// is stubbed (signed-out) and the router hook used by the shell is stubbed.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: async () => null }));
// Rendering the REAL (app) layout statically imports `AccountMenu`, whose
// sign-out server action pulls the auth services barrel → repositories → DB
// client → env validation (which throws without DATABASE_URL in a unit test).
// Mocking the barrel keeps the layout's own <main> intact while never touching
// the database — the same convention as program-detail-page.test.ts.
vi.mock('@/features/auth/services', () => ({}));

import AppError from '@/app/(app)/error';
import AuthError from '@/app/(auth)/error';
import GlobalError from '@/app/global-error';
import AppLayout from '@/app/(app)/layout';
import AuthLayout from '@/app/(auth)/layout';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const SENTINEL = 'SECRET_INTERNAL_DSN_must_not_render';

/** Simulated Server Component data source: throws until the server recovers. */
interface ServerState {
  healthy: boolean;
}

function makeServerPage(state: ServerState) {
  return function ServerPage(): ReactNode {
    if (!state.healthy) {
      throw new Error(SENTINEL);
    }
    return createElement('p', { 'data-testid': 'fresh' }, 'Fresh server content');
  };
}

/**
 * A real `AppRouterInstance`. `refresh` is the fresh-Server-Component-response
 * trigger the framework's `retry()` invokes; the test supplies it and asserts
 * it was called. Every other member is a no-op stub.
 */
function makeRouter(refresh: () => void): AppRouterInstance {
  return {
    back: vi.fn(),
    forward: vi.fn(),
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: '',
  };
}

let container: HTMLDivElement;
let root: Root;
let errorSpy: ReturnType<typeof vi.spyOn>;

function mount(
  errorComponent: React.ComponentType<ErrorInfo>,
  refresh: () => void,
  state: ServerState,
): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const ServerPage = makeServerPage(state);
  act(() => {
    root.render(
      createElement(
        AppRouterContext.Provider,
        { value: makeRouter(refresh) },
        createElement(
          ErrorBoundaryHandler,
          {
            pathname: '/probe',
            errorComponent,
          },
          createElement(ServerPage),
        ),
      ),
    );
  });
}

function findRetryButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes('Try again'),
  );
}

function clickRetry(): void {
  const button = findRetryButton();
  expect(button).toBeDefined();
  act(() => {
    button?.click();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.restoreAllMocks();
});

const BOUNDARIES = [
  ['(app) segment', AppError],
  ['(auth) segment', AuthError],
  ['global', GlobalError],
] as const;

describe.each(BOUNDARIES)('M19 S1 recovery via real framework retry — %s', (_name, Boundary) => {
  it('shows the recoverable error state on an initial Server Component failure', () => {
    const state: ServerState = { healthy: false };
    mount(Boundary, vi.fn(), state);

    const text = container.textContent ?? '';
    expect(text).toContain('temporary problem');
    expect(findRetryButton()).toBeDefined();
    // No internal detail leaks, and the raw error is still logged.
    expect(text).not.toContain(SENTINEL);
    expect(errorSpy.mock.calls.flat().join(' ')).toContain(SENTINEL);
  });

  it('recovery action requests a FRESH response (real retry() → context.refresh())', () => {
    const state: ServerState = { healthy: false };
    const refresh = vi.fn();
    mount(Boundary, refresh, state);

    expect(refresh).not.toHaveBeenCalled();
    clickRetry();
    // The framework's own retry() reached context.refresh() — the fresh-response
    // path — proving recovery does not merely replay the failed response.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('supports repeated failure followed by another retry', () => {
    const state: ServerState = { healthy: false };
    const refresh = vi.fn();
    mount(Boundary, refresh, state);

    clickRetry();
    // Server still down: boundary re-shows the error state after the retry.
    expect(container.textContent ?? '').toContain('temporary problem');
    expect(refresh).toHaveBeenCalledTimes(1);

    clickRetry();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(container.textContent ?? '').toContain('temporary problem');
  });

  it('recovers once the underlying failure disappears', () => {
    const state: ServerState = { healthy: false };
    // The fresh Server Component response now succeeds → server recovers.
    const refresh = vi.fn(() => {
      state.healthy = true;
    });
    mount(Boundary, refresh, state);
    expect(container.textContent ?? '').not.toContain('Fresh server content');

    clickRetry();

    const text = container.textContent ?? '';
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(text).toContain('Fresh server content');
    expect(text).not.toContain('temporary problem');
  });
});

describe('M19 S1 P2 — segment fallback composes with its owning layout to ONE main', () => {
  it('(app) layout + AppError renders exactly one <main> landmark', async () => {
    const tree = await AppLayout({
      children: createElement(AppError, {
        error: new Error(SENTINEL),
        reset: () => {},
        retry: () => {},
      }),
    });
    const html = renderToStaticMarkup(tree);
    // The layout owns the single <main>; the segment fallback contributes none.
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
  });

  it('(auth) layout + AuthError renders exactly one <main> landmark', () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthLayout,
        null,
        createElement(AuthError, {
          error: new Error(SENTINEL),
          reset: () => {},
          retry: () => {},
        }),
      ),
    );
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
  });

  it('global-error owns the whole document and is the single <main> when it renders', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, {
        error: new Error(SENTINEL),
        reset: () => {},
        retry: () => {},
      }),
    );
    expect(html).toContain('<html');
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
  });
});
