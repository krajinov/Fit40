/**
 * @vitest-environment jsdom
 *
 * M15 Slice 6 tests for the program-detail training-schedule section:
 * truthful read-only states (failed read renders nothing and never
 * masquerades as unconfigured; setup copy carries the single approved UTC
 * helper line and NO mutation control), the seven-day Monday–Sunday calendar
 * built from the DTO, status labels exactly as the application resolved them,
 * today marked in text/semantics (never colour alone), the single approved
 * weekly caption with no UTC wording on workout rows, neutral past-due copy,
 * authored-coordinate navigation, and no EnrollmentId anywhere.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The Slice 7 client leaves post to Server Actions that pull the DB
// composition root; stubbed at the module boundary (the enrolled-program-panel
// pattern). The contracts under test are what the markup exposes.
vi.mock('@/features/schedule/actions/configure-training-days', () => ({
  configureTrainingDaysAction: vi.fn(),
}));
vi.mock('@/features/schedule/actions/reschedule-planned-workout', () => ({
  reschedulePlannedWorkoutAction: vi.fn(),
}));

import type { PlannedWorkoutDto, ScheduleReadState } from '@/application/dto/schedule';
import { ProgramScheduleSection } from '@/features/schedule/components/ProgramScheduleSection';

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

const SLUG = 'fit40-beginner-strength';

/** Wednesday 2026-09-23 — week runs Mon 09-21 → Sun 09-27. */
const TODAY = '2026-09-23';

const SETUP_UTC_LINE =
  "Weeks run Monday–Sunday on the app's UTC calendar — the same calendar your weekly insights use.";
const WEEKLY_CAPTION = 'Weeks run Monday–Sunday (UTC).';

function item(overrides: Partial<PlannedWorkoutDto> = {}): PlannedWorkoutDto {
  return {
    scheduledWorkoutId: 'sw-1',
    weekNumber: 1,
    workoutOrder: 1,
    workoutName: 'Upper Body A',
    plannedDate: TODAY,
    status: 'planned',
    ...overrides,
  };
}

/**
 * Configured schedule covering every status: a past-due workout from last
 * week (outside the seven slots), Monday past-due inside the week, an
 * in-progress workout dated today, and a planned Friday workout.
 */
function configuredState(): ScheduleReadState {
  const pastDueEarliest = item({
    scheduledWorkoutId: 'sw-old',
    plannedDate: '2026-09-18',
    workoutName: 'Last Friday',
    status: 'past-due',
  });
  const mondayPastDue = item({
    scheduledWorkoutId: 'sw-mon',
    plannedDate: '2026-09-21',
    workoutName: 'Upper Body A',
    status: 'past-due',
  });
  const todayInProgress = item({
    scheduledWorkoutId: 'sw-today',
    plannedDate: TODAY,
    workoutName: 'Lower Body B',
    workoutOrder: 2,
    status: 'in-progress',
  });
  const fridayPlanned = item({
    scheduledWorkoutId: 'sw-fri',
    plannedDate: '2026-09-25',
    workoutName: 'Conditioning C',
    workoutOrder: 3,
    status: 'planned',
  });
  const sundayCompleted = item({
    scheduledWorkoutId: 'sw-sun',
    plannedDate: '2026-09-27',
    workoutName: 'Mobility D',
    workoutOrder: 4,
    status: 'completed',
  });

  return {
    status: 'loaded',
    schedule: {
      programSlug: SLUG,
      configured: true,
      today: TODAY,
      items: [pastDueEarliest, mondayPastDue, todayInProgress, fridayPlanned, sundayCompleted],
      focus: {
        today: todayInProgress,
        next: fridayPlanned,
        pastDue: { count: 2, earliest: pastDueEarliest },
      },
    },
  };
}

function unconfiguredState(): ScheduleReadState {
  return {
    status: 'loaded',
    schedule: {
      programSlug: SLUG,
      configured: false,
      today: TODAY,
      items: [],
      focus: { today: null, next: null, pastDue: null },
    },
  };
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function renderSection(schedule: ScheduleReadState): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ProgramScheduleSection, { schedule }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('ProgramScheduleSection (M15 Slice 6)', () => {
  it('renders nothing for a failed read — never masquerading as unconfigured', async () => {
    const container = await renderSection({ status: 'unavailable' });

    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).not.toContain('Training schedule');
    expect(container.textContent).not.toContain('No training days set yet');
    expect(container.textContent).not.toContain('Choose your training days');
  });

  it('renders the setup state with the single approved UTC helper and the real training-days form', async () => {
    const container = await renderSection(unconfiguredState());

    expect(container.querySelector('section')?.id).toBe('training-schedule');
    expect(container.textContent).toContain('Training schedule');
    expect(container.textContent).toContain(
      'Choose your training days to put this program on your calendar.',
    );
    expect(container.textContent).toContain('No training days set yet.');
    expect(container.textContent).toContain(SETUP_UTC_LINE);
    // Exactly one setup disclosure; no weekly caption in this state.
    expect(occurrences(container.textContent ?? '', SETUP_UTC_LINE)).toBe(1);
    expect(occurrences(container.textContent ?? '', 'UTC')).toBe(1);

    // Slice 7: the setup state offers the real, minimal form — seven labelled
    // weekday controls and one submit — and no change-mode copy yet.
    expect(container.querySelectorAll('input[name="weekday"]')).toHaveLength(7);
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe('Set training days');
    expect(container.querySelectorAll('form')).toHaveLength(1);
    expect(container.textContent).not.toContain('Choose a new weekly pattern.');
  });

  it('renders seven accessible Monday–Sunday day positions for the current week', async () => {
    const container = await renderSection(configuredState());

    const list = container.querySelector('ol[aria-label="This week"]');
    expect(list).not.toBeNull();
    const slots = [...(list?.querySelectorAll('li') ?? [])];
    expect(slots).toHaveLength(7);
    expect(slots.map((slot) => slot.textContent?.slice(0, 3))).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    for (const date of ['Sep 21', 'Sep 22', 'Sep 23', 'Sep 24', 'Sep 25', 'Sep 26', 'Sep 27']) {
      expect(container.textContent).toContain(date);
    }
  });

  it('places each planned workout on its canonical calendar date', async () => {
    const container = await renderSection(configuredState());
    const slots = [...container.querySelectorAll('ol li')];

    // Mon past-due, Wed in-progress, Fri planned, Sun completed — Tuesday and
    // Thursday stay empty; last week's past-due item is outside the week.
    expect(slots[0]?.textContent).toContain('Upper Body A');
    expect(slots[2]?.textContent).toContain('Lower Body B');
    expect(slots[4]?.textContent).toContain('Conditioning C');
    expect(slots[6]?.textContent).toContain('Mobility D');
    // Last week's past-due item is outside these seven slots (it is named
    // only by the earliest-past-due summary above the calendar).
    for (const slot of slots) {
      expect(slot.textContent ?? '').not.toContain('Last Friday');
    }
  });

  it('marks today in text and semantics, not colour alone', async () => {
    const container = await renderSection(configuredState());

    const todaySlot = container.querySelector('li[aria-current="date"]');
    expect(todaySlot).not.toBeNull();
    expect(todaySlot?.getAttribute('aria-current')).toBe('date');
    expect(todaySlot?.textContent).toContain('Today');
    expect(todaySlot?.textContent).toContain('Wed');
    // Exactly one today marker across the seven slots.
    expect(container.querySelectorAll('li[aria-current="date"]')).toHaveLength(1);
    expect(occurrences(container.textContent ?? '', 'Today')).toBe(1);
  });

  it('labels an in-progress workout truthfully with the safe session Resume link', async () => {
    const container = await renderSection(configuredState());

    expect(container.textContent).toContain('In progress');
    const resume = container.querySelector<HTMLAnchorElement>(
      `a[href="/programs/${SLUG}/weeks/1/workouts/2/session"]`,
    );
    expect(resume?.textContent).toBe('Resume');
  });

  it('labels a completed workout truthfully and offers no Start action', async () => {
    const container = await renderSection(configuredState());

    expect(container.textContent).toContain('Completed');
    expect(container.textContent).not.toContain('Start');
    expect(container.textContent).not.toContain('Start workout');
  });

  it('summarises past-due workouts neutrally with count and earliest', async () => {
    const container = await renderSection(configuredState());
    const summary = container.querySelector('[data-testid="schedule-past-due"]');

    expect(summary?.textContent).toContain('2 planned workouts behind schedule');
    expect(summary?.textContent).toContain('Earliest: Last Friday · Sep 18');
    // The in-week past-due workout carries its neutral label in its slot.
    expect(container.textContent).toContain('Past due');
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('failed');
    expect(text).not.toContain('missed');
    expect(text).not.toContain('skipped');
  });

  it('renders a neutral empty state on days without a planned workout', async () => {
    const container = await renderSection(configuredState());
    const slots = [...container.querySelectorAll('ol li')];

    // Tuesday and Thursday have no planned workout.
    expect(slots[1]?.textContent).toContain('No workout planned');
    expect(slots[3]?.textContent).toContain('No workout planned');
    expect(slots[1]?.textContent).not.toContain('Rest day');
  });

  it('shows the single approved weekly caption and no UTC wording on workout rows', async () => {
    const container = await renderSection(configuredState());
    const text = container.textContent ?? '';

    expect(occurrences(text, WEEKLY_CAPTION)).toBe(1);
    // The caption is the ONLY UTC wording in the configured state.
    expect(occurrences(text, 'UTC')).toBe(1);
    for (const slot of container.querySelectorAll('ol li')) {
      expect(slot.textContent ?? '').not.toContain('UTC');
    }
  });

  it('navigates by authored public coordinates and exposes no EnrollmentId', async () => {
    const container = await renderSection(configuredState());

    expect(container.textContent).toContain('Week 1 · Workout 3');
    const details = container.querySelector<HTMLAnchorElement>(
      `a[href="/programs/${SLUG}/weeks/1/workouts/3"]`,
    );
    expect(details?.textContent).toBe('Conditioning C');

    expect(container.innerHTML).not.toContain('enr-');
    expect(container.innerHTML).not.toContain('sw-');
    for (const anchor of container.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href.startsWith(`/programs/${SLUG}/weeks/`)).toBe(true);
      expect(href).not.toContain('enr-');
    }
    // Slice 7: only public fields exist in the scheduling forms — two Move
    // forms (Monday past-due, Friday planned) plus the change-days form — and
    // no enrollment/database/session/user identity anywhere.
    expect(container.querySelectorAll('form')).toHaveLength(3);
    const fieldNames = [...container.querySelectorAll<HTMLInputElement>('input')].map(
      (input) => input.name,
    );
    expect(fieldNames.every((name) => name === 'weekday' || name === 'date')).toBe(true);
    expect(fieldNames).not.toContain('enrollmentId');
    expect(fieldNames).not.toContain('scheduledWorkoutId');
    expect(fieldNames).not.toContain('sessionId');
    expect(fieldNames).not.toContain('userId');
  });

  it('offers the change-training-days affordance with the replacement copy and an empty selection', async () => {
    const container = await renderSection(configuredState());

    const summary = [...container.querySelectorAll('summary')].find(
      (node) => node.textContent === 'Change training days',
    );
    expect(summary).not.toBeUndefined();
    expect(container.textContent).toContain(
      'Choose a new weekly pattern. Saving replaces the dates of future workouts; completed workouts stay in history and in-progress workouts keep their current date.',
    );
    // The current planned dates imply weekdays, but M15 stores dates — the
    // replacement selection never claims to be a persisted preference.
    const weekdayInputs = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="weekday"]'),
    ];
    expect(weekdayInputs).toHaveLength(7);
    expect(weekdayInputs.every((input) => input.checked === false)).toBe(true);
  });

  it('offers Move only for never-started workouts, never for completed or in-progress ones', async () => {
    const container = await renderSection(configuredState());
    const slots = [...container.querySelectorAll('ol li')];
    const moveCount = (index: number): number =>
      [...(slots[index]?.querySelectorAll('summary') ?? [])].filter(
        (node) => node.textContent === 'Move',
      ).length;

    // Mon = past-due and Fri = planned are never-started, so both expose Move
    // (the approved plan names manual rescheduling as a past-due remedy).
    expect(moveCount(0)).toBe(1);
    expect(moveCount(4)).toBe(1);
    // Wed = in-progress and Sun = completed stay read-only.
    expect(moveCount(2)).toBe(0);
    expect(moveCount(6)).toBe(0);
    // Empty days expose nothing at all.
    expect(moveCount(1)).toBe(0);
    expect(moveCount(3)).toBe(0);
  });

  it('renders component-based date labels, never raw canonical ISO dates', async () => {
    const container = await renderSection(configuredState());
    const text = container.textContent ?? '';

    expect(text).toContain('Sep 25');
    expect(text).not.toContain('2026-09-25');
    expect(text).not.toContain('Invalid');
  });

  it('degrades to nothing when the schedule data cannot build a truthful week', async () => {
    const broken = configuredState();
    if (broken.status !== 'loaded') throw new Error('fixture must be loaded');
    const container = await renderSection({
      status: 'loaded',
      schedule: { ...broken.schedule, today: 'not-a-date' },
    });

    expect(container.querySelector('section')).toBeNull();
    expect(container.textContent).not.toContain('No training days set yet');
  });
});