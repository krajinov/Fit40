// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppError from '@/app/(app)/error';
import AuthError from '@/app/(auth)/error';
import GlobalError from '@/app/global-error';

/**
 * S1 (M19) regression tests for the recoverable error boundaries.
 *
 * P1: the recovery button must delegate to the framework `retry` mechanism
 *     (which the framework implements as context.refresh() + reset(), i.e. a
 *     FRESH Server Component response) — never to `reset()` alone (state-only).
 * P2: segment boundaries render a non-landmark <div>; only global-error, which
 *     owns the whole document, keeps the <main> landmark.
 *
 * The rendered-output assertions below prove no internal error detail leaks to
 * users, that logging is preserved, and that the boundaries stay distinct from
 * auth redirects / not-found. Fresh-response recovery is covered by the
 * framework-integration harness in `error-boundary-recovery.test.ts`, which
 * drives the real Next.js ErrorBoundaryHandler retry() -> router refresh() ->
 * reset() mechanism and asserts repeated failures plus a simulated successful
 * recovery. The production probe recorded in the S1 report verifies only the
 * HTTP error response and information-leak behavior; no real-browser
 * end-to-end retry/recovery test was performed (retry()'s refresh() is
 * framework code we do not reimplement).
 */

const SENTINEL = 'SECRET_INTERNAL_DSN_must_not_render';

function makeError(): Error {
  return new Error(SENTINEL);
}

let container: HTMLDivElement;
let root: Root;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Tells React this environment supports act(...), so state updates from the
  // recovery wiring are flushed synchronously and asserted reliably.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Silence the boundary's real server-side console.error logging during tests;
  // the logging-preservation test below asserts against this shared spy.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.restoreAllMocks();
});

function render(element: React.ReactElement): void {
  act(() => {
    root.render(element);
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
}

describe('S1 segment error boundaries', () => {
  for (const [name, Component] of [
    ['(app)', AppError],
    ['(auth)', AuthError],
  ] as const) {
    describe(name, () => {
      it('renders a recoverable, user-friendly state without leaking internals', () => {
        render(createElement(Component, { error: makeError(), reset: () => {}, retry: () => {} }));

        const text = container.textContent ?? '';
        expect(text).toContain('Something went wrong');
        expect(text).toContain('temporary problem');
        expect(findButton('Try again')).toBeDefined();

        // No internal error detail reaches the DOM.
        expect(text).not.toContain(SENTINEL);
        expect(text.toLowerCase()).not.toContain('error:');
        expect(text.toLowerCase()).not.toContain('stack');

        // Logging is preserved: the raw error is logged server-side.
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy.mock.calls.flat().join(' ')).toContain(SENTINEL);
      });

      it('uses a non-landmark container (no nested <main>) — P2', () => {
        render(createElement(Component, { error: makeError(), reset: () => {}, retry: () => {} }));
        expect(container.querySelector('main')).toBeNull();
        expect(container.querySelector('[role="alert"]')).not.toBeNull();
      });

      it('delegates recovery to the framework retry mechanism, not reset()', () => {
        const retry = vi.fn();
        render(createElement(Component, { error: makeError(), reset: () => {}, retry }));

        const button = findButton('Try again');
        expect(button).toBeDefined();
        act(() => {
          button?.click();
        });
        // retry() is the fresh-Server-Component-response path (refresh()+reset()).
        expect(retry).toHaveBeenCalledTimes(1);
      });

      it('has an accessible button label and is keyboard-focusable', () => {
        render(createElement(Component, { error: makeError(), reset: () => {}, retry: () => {} }));
        const button = findButton('Try again');
        expect(button).toBeDefined();
        expect(button?.getAttribute('type')).toBe('button');
        // Focusable via keyboard (native button default, not disabled).
        expect(button?.disabled).toBe(false);
      });
    });
  }
});

describe('S1 global-error boundary (owns the document)', () => {
  it('renders its own <html>/<body> and keeps a single <main> landmark', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: makeError(), reset: () => {}, retry: () => {} }),
    );
    expect(html).toContain('<html');
    expect(html).toContain('<body');
    expect(html).toContain('<main');
    expect((html.match(/<main[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('Try again');
    // Inline-styled fallback usable when Tailwind/app shell have failed.
    expect(html.toLowerCase()).toContain('style=');
  });

  it('does not leak internal error details into the document', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: makeError(), reset: () => {}, retry: () => {} }),
    );
    expect(html).not.toContain(SENTINEL);
    expect(html.toLowerCase()).not.toContain('error:');
  });
});
