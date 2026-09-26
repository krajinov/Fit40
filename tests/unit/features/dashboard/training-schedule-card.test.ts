/**
 * @vitest-environment jsdom
 *
 * M15 Slice 5 tests for the dashboard's training-schedule card: the setup
 * prompt (with a real, future-safe route — no dead links), truthful Today /
 * Next / Past-due rendering straight from the application DTO, the safe
 * session destination (no session id is invented), component-only date labels
 * (no timezone-sensitive parsing), and no EnrollmentId anywhere in the DOM.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { DashboardScheduleState } from '@/application/dto/dashboard';
import type {
  EnrollmentScheduleDto,
  PlannedWorkoutDto,
  ScheduleFocusDto,
} from '@/application/dto/schedule';
import { TrainingScheduleCard } from '@/features/dashboard/components/TrainingScheduleCard';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

const PROGRAM_SLUG = 'prog-1';
const PROGRAM_NAME = 'Fit40 Beginner Strength';
const SESSION_PATH = `/programs/${PROGRAM_SLUG}/weeks/1/workouts/1/session`;
const DETAILS_PATH = `/programs/${PROGRAM_SLUG}/weeks/1/workouts/1`;

function item(overrides: Partial<PlannedWorkoutDto> = {}): PlannedWorkoutDto {
  return {
    scheduledWorkoutId: 'sw-1',
    weekNumber: 1,
    workoutOrder: 1,
    workoutName: 'Workout A',
    plannedDate: '2026-09-23',
    status: 'planned',
    ...overrides,
  };
}

function configuredState(focus: Partial<ScheduleFocusDto>): DashboardScheduleState {
  const schedule: EnrollmentScheduleDto = {
    programSlug: PROGRAM_SLUG,
    configured: true,
    today: '2026-09-23',
    items: [],
    focus: { today: null, next: null, pastDue: null, ...focus },
  };
  return { status: 'loaded', schedule };
}

function unconfiguredState(): DashboardScheduleState {
  return {
    status: 'loaded',
    schedule: {
      programSlug: PROGRAM_SLUG,
      configured: false,
      today: '2026-09-23',
      items: [],
      focus: { today: null, next: null, pastDue: null },
    },
  };
}

async function renderCard(state: DashboardScheduleState): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(TrainingScheduleCard, { state, programName: PROGRAM_NAME }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('TrainingScheduleCard (M15)', () => {
  it('renders nothing for a failed schedule read — never an unconfigured prompt', async () => {
    const container = await renderCard({ status: 'unavailable' });

    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).not.toContain('Set training days');
    expect(container.textContent).not.toContain('Training schedule');
  });

  it('offers the training-days setup prompt with a real, future-safe route', async () => {
    const container = await renderCard(unconfiguredState());

    const heading = container.querySelector('h2');
    expect(heading?.textContent).toBe('Training schedule');
    expect(container.textContent).toContain(
      'Choose your training days to put this program on your calendar.',
    );

    const cta = container.querySelector<HTMLAnchorElement>('a');
    expect(cta?.textContent).toBe('Set training days');
    // Program detail is an existing route (Slice 6 hosts the setup form
    // there); the link must never point at a route that does not exist yet.
    expect(cta?.getAttribute('href')).toBe('/programs/prog-1');
    expect(cta?.className).toContain('h-[52px]');
    // Setup state adds no workout action of its own.
    expect(container.textContent).not.toContain('Start workout');
    expect(container.textContent).not.toContain('Resume workout');
  });

  it('shows today\'s planned workout with authored context and the session destination', async () => {
    const container = await renderCard(
      configuredState({ today: item({ workoutName: 'Upper Body', status: 'planned' }) }),
    );

    expect(container.textContent).toContain('TODAY');
    expect(container.textContent).toContain('Upper Body');
    expect(container.textContent).toContain('Week 1 · Workout 1');
    expect(container.textContent).toContain(PROGRAM_NAME);

    const start = container.querySelector<HTMLAnchorElement>('a');
    expect(start?.textContent).toBe('Start workout');
    expect(start?.getAttribute('href')).toBe(SESSION_PATH);
    const details = container.querySelectorAll<HTMLAnchorElement>('a')[1];
    expect(details?.textContent).toBe('View details');
    expect(details?.getAttribute('href')).toBe(DETAILS_PATH);
  });

  it('shows an in-progress workout as resumable, truthfully', async () => {
    const container = await renderCard(
      configuredState({ today: item({ status: 'in-progress' }) }),
    );

    expect(container.textContent).toContain('In progress');
    const resume = container.querySelector<HTMLAnchorElement>('a');
    expect(resume?.textContent).toBe('Resume workout');
    expect(resume?.getAttribute('href')).toBe(SESSION_PATH);
  });

  it('shows today\'s completed workout as done — not as something still to do', async () => {
    const container = await renderCard(
      configuredState({
        today: item({ status: 'completed' }),
        next: item({ scheduledWorkoutId: 'sw-2', workoutOrder: 2, workoutName: 'Workout B' }),
      }),
    );

    expect(container.textContent).toContain('Completed today');
    const links = [...container.querySelectorAll('a')].map((anchor) => anchor.textContent);
    expect(links).not.toContain('Start workout');
    expect(links).not.toContain('Resume workout');
    // The next workout is still surfaced once today's is done.
    expect(container.textContent).toContain('NEXT WORKOUT');
    expect(container.textContent).toContain('Workout B');
  });

  it('shows the next workout with a human-readable planned date when nothing is planned today', async () => {
    const container = await renderCard(
      configuredState({
        next: item({ workoutName: 'Lower Body', plannedDate: '2026-09-30' }),
      }),
    );

    expect(container.textContent).toContain('NEXT WORKOUT');
    expect(container.textContent).toContain('Lower Body');
    // Component-based calendar label: never the raw ISO string and never an
    // invalid/locale-shifted Date rendering.
    expect(container.textContent).toContain('Planned for Sep 30');
    expect(container.textContent).not.toContain('2026-09-30');
    expect(container.textContent).not.toContain('Invalid');
  });

  it('hides the next block while a workout is still actionable today', async () => {
    const container = await renderCard(
      configuredState({
        today: item({ status: 'planned' }),
        next: item({ scheduledWorkoutId: 'sw-2', workoutOrder: 2, workoutName: 'Workout B' }),
      }),
    );

    expect(container.textContent).toContain('TODAY');
    expect(container.textContent).not.toContain('NEXT WORKOUT');
    expect(container.textContent).not.toContain('Workout B');
  });

  it('states the past-due count neutrally, without claiming a skip or failure', async () => {
    const container = await renderCard(
      configuredState({
        pastDue: { count: 2, earliest: item({ plannedDate: '2026-09-16' }) },
      }),
    );

    expect(container.textContent).toContain('2 planned workouts behind schedule');
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('skipped');
    expect(text.toLowerCase()).not.toContain('failed');
    expect(text.toLowerCase()).not.toContain('missed');
  });

  it('pluralises a single past-due workout', async () => {
    const container = await renderCard(
      configuredState({
        pastDue: { count: 1, earliest: item({ plannedDate: '2026-09-16' }) },
      }),
    );

    expect(container.textContent).toContain('1 planned workout behind schedule');
  });

  it('keeps today and past-due visible together — neither truth replaces the other', async () => {
    const container = await renderCard(
      configuredState({
        today: item({ status: 'planned' }),
        pastDue: { count: 3, earliest: item({ plannedDate: '2026-09-14' }) },
      }),
    );

    expect(container.textContent).toContain('TODAY');
    expect(container.textContent).toContain('3 planned workouts behind schedule');
  });

  it('exposes no EnrollmentId or database identity in links, forms or the DOM', async () => {
    const container = await renderCard(
      configuredState({
        today: item({ status: 'planned' }),
        next: item({ scheduledWorkoutId: 'sw-2', workoutOrder: 2 }),
        pastDue: { count: 1, earliest: item({ scheduledWorkoutId: 'sw-3' }) },
      }),
    );

    const html = container.innerHTML;
    expect(html).not.toContain('enr-');
    expect(container.querySelectorAll('form')).toHaveLength(0);
    for (const anchor of container.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') ?? '';
      // Authored public coordinates only.
      expect(href.startsWith(`/programs/${PROGRAM_SLUG}/weeks/`)).toBe(true);
      expect(href).not.toContain('enr-');
      expect(href).not.toContain('sw-');
    }
  });
});
