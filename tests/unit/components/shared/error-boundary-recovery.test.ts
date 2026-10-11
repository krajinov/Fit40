// @vitest-environment jsdom
/**
 * Fit40-owned boundary contracts: fixed error copy, privacy, accessible retry
 * controls, callback delegation, and composition with the owning layouts.
 * These tests do not prove framework refresh behavior or server recovery.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real application layouts while isolating authentication and DB reads.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/features/auth/current-user', () => ({ getCurrentUser: async () => null }));
vi.mock('@/features/auth/services', () => ({}));

import AppError from '@/app/(app)/error';
import AuthError from '@/app/(auth)/error';
import GlobalError from '@/app/global-error';
import AppLayout from '@/app/(app)/layout';
import AuthLayout from '@/app/(auth)/layout';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const SENTINEL = 'SECRET_INTERNAL_DSN_must_not_render';
const BOUNDARIES = [
  ['(app) segment', AppError],
  ['(auth) segment', AuthError],
  ['global', GlobalError],
] as const;

let container: Document | HTMLDivElement;
let root: Root | undefined;
let frame: HTMLIFrameElement | undefined;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  if (container instanceof HTMLDivElement) container.remove();
  frame?.remove();
  frame = undefined;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.restoreAllMocks();
});

function findRetryButton(): HTMLButtonElement {
  const button = container.querySelector('button');
  if (button === null) throw new Error('Expected a retry button');
  return button;
}

function clickRetry(): void {
  act(() => findRetryButton().click());
}

describe.each(BOUNDARIES)('M19 S1 public boundary contract — %s', (_name, Boundary) => {
  function mount(retry = vi.fn(), reset = vi.fn()): Error {
    // A document with a browsing context lets the global button receive focus.
    if (Boundary === GlobalError) {
      frame = document.createElement('iframe');
      document.body.appendChild(frame);
      const frameDocument = frame.contentDocument;
      if (frameDocument === null) throw new Error('Expected an iframe document');
      container = frameDocument;
    } else {
      container = document.createElement('div');
    }
    if (container instanceof HTMLDivElement) document.body.appendChild(container);
    root = createRoot(container);
    const error = new Error(SENTINEL);
    act(() => root?.render(createElement(Boundary, { error, retry, reset })));
    return error;
  }

  it('renders fixed error copy and logs the error without exposing internal details', () => {
    const error = mount();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('temporary problem');
    expect(container.querySelector('h1, h2')?.textContent).toBeTruthy();
    expect(container.querySelector('p')?.textContent).toBeTruthy();
    const html = container instanceof HTMLDivElement
      ? container.innerHTML : container.documentElement.outerHTML;
    expect(html).not.toContain(SENTINEL);
    expect(html).not.toContain(error.stack);
    expect(errorSpy).toHaveBeenCalledWith(expect.any(String), error);
  });

  it('invokes the supplied retry callback without invoking reset', () => {
    const retry = vi.fn();
    const reset = vi.fn();
    mount(retry, reset);
    expect(retry).not.toHaveBeenCalled();
    clickRetry();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('invokes the callback on each repeated attempt while the fallback remains visible', () => {
    const retry = vi.fn();
    const reset = vi.fn();
    mount(retry, reset);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      clickRetry();
      expect(retry).toHaveBeenCalledTimes(attempt);
      expect(container.querySelector('[role="alert"]')?.textContent)
        .toContain('temporary problem');
    }
    expect(reset).not.toHaveBeenCalled();
  });

  it('provides a named, enabled, focusable native retry button and an alert', () => {
    mount();
    const button = findRetryButton();
    expect(button.textContent?.trim()).toBe('Try again');
    expect(button.type).toBe('button');
    expect(button.disabled).toBe(false);
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(button.ownerDocument.activeElement).toBe(button);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
