/**
 * @vitest-environment jsdom
 *
 * M19 S1 — behavioral tests for the recoverable error layer.
 *
 * Two concerns are verified here:
 *  1. `ErrorState` (the shared, presentational primitive) renders only the
 *     fixed, caller-supplied copy and never any raw error object.
 *  2. Each App Router boundary (`(app)/error`, `(auth)/error`, `global-error`)
 *     logs the unexpected error, shows non-technical copy, exposes a working
 *     retry that calls `reset()`, and NEVER leaks the internal message/stack.
 *
 * Redirects, `notFound()`, and expected typed "unavailable" states are handled
 * by the framework / view mappers and never reach these components — they are
 * covered by the architecture guard (error-boundaries.test.ts) and were proven
 * live during the Correction 3 boundary probes (see the S1 report).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { ErrorState } from '@/components/shared/ErrorState';
import AppError from '@/app/(app)/error';
import AuthError from '@/app/(auth)/error';
import GlobalError from '@/app/global-error';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  vi.restoreAllMocks();
});

describe('ErrorState (shared primitive)', () => {
  it('renders the fixed title and body with an accessible alert role', async () => {
    const container = await render(
      createElement(ErrorState, { title: 'Something went wrong.', body: 'Temporary problem.' }),
    );

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Something went wrong.');
    expect(container.textContent).toContain('Temporary problem.');
  });

  it('renders a caller-supplied action (the retry control)', async () => {
    const container = await render(
      createElement(ErrorState, {
        title: 'Error',
        action: createElement('button', { type: 'button' }, 'Try again'),
      }),
    );

    expect(container.querySelector('button')?.textContent).toBe('Try again');
  });

  it('omits the body paragraph when no body is supplied', async () => {
    const container = await render(createElement(ErrorState, { title: 'Only a title' }));

    expect(container.textContent).toBe('Only a title');
  });
});

describe.each([
  ['(app) boundary', AppError, 'Unhandled error in Fit40 application route'],
  ['(auth) boundary', AuthError, 'Unhandled error in Fit40 authentication route'],
  ['global boundary', GlobalError, 'Unhandled error in Fit40 root layout'],
] as const)('%s', (_name, Boundary, logPrefix) => {
  it('logs the unexpected error for operators', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('connection terminated unexpectedly at db.internal:5432');

    await render(createElement(Boundary, { error: boom, reset: () => {} }));

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some((call) => String(call[0]).startsWith(logPrefix))).toBe(true);
  });

  it('never leaks the internal message, stack or host details to the user', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('connection terminated unexpectedly at db.internal:5432');
    boom.stack = 'Error: boom\n    at render (/secret/path.tsx:1:1)';

    const container = await render(createElement(Boundary, { error: boom, reset: () => {} }));

    expect(container.textContent).not.toContain('connection terminated unexpectedly');
    expect(container.textContent).not.toContain('db.internal:5432');
    expect(container.textContent).not.toContain('/secret/path.tsx');
    expect(container.textContent).not.toContain('at render');
  });

  it('exposes a working retry control wired to reset()', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();

    const container = await render(createElement(Boundary, { error: new Error('x'), reset }));
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Try again');

    await act(async () => {
      button?.click();
    });

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('is an accessible alert with a reachable, labeled button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = await render(createElement(Boundary, { error: new Error('x'), reset: () => {} }));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    const button = container.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect((button?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('global-error boundary structure', () => {
  it('renders its own html/body shell so it works without the root layout', () => {
    // Rendered to an HTML string (not a jsdom container): <html>/<body> cannot
    // be mounted inside a test div, but the serialized markup proves the
    // boundary supplies the full document shell when the root layout has failed.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: new Error('x'), reset: () => {} }),
    );

    expect(html).toMatch(/^<html/);
    expect(html).toContain('<body');
    expect(html).toContain('lang="en"');
    expect(html).toContain('Try again');
  });
});
