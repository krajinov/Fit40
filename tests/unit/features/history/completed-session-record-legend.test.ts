/**
 * @vitest-environment jsdom
 *
 * Presentation test for the visible PR legend (post-M12 polish): the screen
 * explains the badge in plain text with the exact "at the time" wording, and
 * adds no controls. The conditional application of the legend is decided by
 * the view model's `hasPersonalRecords` (covered in
 * `completed-session-view.test.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { CompletedSessionRecordLegend } from '@/features/history/components/CompletedSessionRecordLegend';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderLegend(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(CompletedSessionRecordLegend));
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
});

describe('CompletedSessionRecordLegend', () => {
  it('explains the badge with the historical “at the time” wording', async () => {
    const container = await renderLegend();

    expect(container.textContent?.trim()).toBe(
      'PR marks the set that established a personal record for that exercise at the time.',
    );
  });

  it('is plain explanatory text with no controls', async () => {
    const container = await renderLegend();

    expect(container.querySelector('p')).not.toBeNull();
    expect(container.querySelectorAll('a, button, form')).toHaveLength(0);
  });
});