/**
 * M17 Slice 11 — architecture guards for the settlement PRESENTATION.
 *
 * Source-level: which layer each new surface may call, which vocabulary it
 * may use, and what it may never touch. Behaviour is locked by the action,
 * view and panel tests; Domain/Application semantics are locked by the M14/M17
 * suites. Guards are scoped to the M17 surfaces and their neighbours, never a
 * whole-repository prose grep.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const RECORD_ACTION = 'src/features/schedule/actions/record-not-performed.ts';
const UNDO_ACTION = 'src/features/schedule/actions/undo-not-performed.ts';
const SCHEDULE_ACTIONS = [RECORD_ACTION, UNDO_ACTION];

/** The new settlement surfaces (forms, affordance switch, unplaced list). */
const SETTLEMENT_SURFACES = [
  'src/features/schedule/components/RecordNotPerformedForm.tsx',
  'src/features/schedule/components/UndoNotPerformedForm.tsx',
  'src/features/schedule/components/ScheduleSlotControls.tsx',
  'src/features/schedule/components/UnplacedNotPerformedList.tsx',
  'src/features/enrollment/components/ConcludedRunCallout.tsx',
];

const M16_SECTION = 'src/features/schedule/components/PlanFollowThroughSection.tsx';
const M16_VIEW = 'src/features/schedule/follow-through-view.ts';
/**
 * Surfaces that must never mention a date at all. `ScheduleSlotControls` is
 * deliberately absent: it forwards the EXISTING planned date to the unchanged
 * Move disclosure (M15 behavior), and inventing nothing itself.
 */
const NO_DATE_SURFACES = [
  'src/features/schedule/components/RecordNotPerformedForm.tsx',
  'src/features/schedule/components/UndoNotPerformedForm.tsx',
  'src/features/schedule/components/UnplacedNotPerformedList.tsx',
  'src/features/enrollment/components/ConcludedRunCallout.tsx',
];
const COMPLETED_PAGE = 'src/app/(app)/programs/[programSlug]/completed/page.tsx';
const COMPLETION_SUMMARY = 'src/application/use-cases/get-program-completion-summary.ts';
const RESTART_ACTION = 'src/features/enrollment/actions/restart-program.ts';
const PANEL_STATE = 'src/features/enrollment/program-panel-state.ts';
const STATUS_VIEW = 'src/features/schedule/schedule-week-view.ts';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/** Every `.ts`/`.tsx` file under one source directory, recursively. */
function sourceFiles(relativeDir: string): ReadonlyArray<string> {
  const entries = readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(child));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(child);
    }
  }
  return files;
}

describe('M17 Slice 11 — Server Actions delegate to Application, never to persistence', () => {
  it('calls the Slice 7 use cases and imports no repository, ORM or transaction', () => {
    const expectations: ReadonlyArray<readonly [string, string]> = [
      [RECORD_ACTION, 'recordNotPerformedUseCase.execute('],
      [UNDO_ACTION, 'undoNotPerformedUseCase.execute('],
    ];

    for (const [file, call] of expectations) {
      const code = codeOf(file);
      expect(code, `${file} must be a Server Action`).toContain("'use server'");
      expect(code, `${file} must delegate to its use case`).toContain(call);
      // Layer boundary: presentation reaches Application only.
      expect(code).not.toContain('Repository');
      expect(code).not.toContain('infrastructure');
      expect(code).not.toContain('drizzle');
      expect(code).not.toContain('transaction(');
      expect(code).not.toContain('RunOccurrenceWriteRepository');
      // And it may not decide settlement itself.
      expect(code).not.toContain('decideRecordNotPerformed');
      expect(code).not.toContain('decideUndoNotPerformed');
      expect(code).not.toContain('resolveRunClosure');
    }
  });

  it('owns the record clock at the action boundary and gives undo none', () => {
    const record = codeOf(RECORD_ACTION);
    expect(record).toContain('const recordedAt = new Date();');
    expect(record).toContain('recordedAt,');

    const undo = codeOf(UNDO_ACTION);
    expect(undo).not.toContain('new Date(');
    expect(undo).not.toContain('recordedAt');
  });

  it('reads only the authored coordinates out of form data', () => {
    for (const file of SCHEDULE_ACTIONS) {
      const code = codeOf(file);
      expect(code).toContain('parseAuthoredOccurrenceFormData(formData)');
      expect(code).not.toContain("formData.get('enrollmentId')");
      expect(code).not.toContain("formData.get('scheduledWorkoutId')");
      expect(code).not.toContain("formData.get('userId')");
      expect(code).not.toContain("formData.get('recordedAt')");
    }
  });
});

describe('M17 Slice 11 — presentation never touches persistence or Domain decisions', () => {
  it('imports no Drizzle module or schema from any feature file', () => {
    const offenders = sourceFiles('src/features').filter((file) => {
      const code = codeOf(file);
      return (
        code.includes("from 'drizzle-orm") ||
        code.includes('infrastructure/database/schema') ||
        code.includes('drizzle-orm/postgres-js')
      );
    });

    expect(offenders).toEqual([]);
  });

  it('never calls the Domain settlement decisions or refusals', () => {
    const forbidden = [
      'decideRecordNotPerformed',
      'decideUndoNotPerformed',
      'RecordNotPerformedRefusal',
      'UndoNotPerformedRefusal',
    ];
    const offenders = sourceFiles('src/features').filter((file) => {
      const code = codeOf(file);
      return forbidden.some((name) => code.includes(name));
    });

    expect(offenders).toEqual([]);
  });

  it('never computes a completion, conclusion or restartability verdict itself', () => {
    // Function CALLS only: DTO property reads such as `runClosure.isProgramComplete`
    // are the presentation contract, not a recomputation.
    const verdictCalls = [/isRunConcluded\s*\(/, /isProgramComplete\s*\(/, /isRunRestartable\s*\(/];
    const offenders = sourceFiles('src/features').filter((file) => {
      const code = codeOf(file);
      return verdictCalls.some((pattern) => pattern.test(code));
    });

    expect(offenders).toEqual([]);
    // The panel state module reads verdicts off the DTO and copies the gate.
    expect(codeOf(PANEL_STATE)).toContain('runClosure.isConcluded');
    expect(codeOf(PANEL_STATE)).toContain('runClosure.isProgramComplete');
    expect(codeOf(PANEL_STATE)).toContain('restartAvailable: runClosure.restartAvailable');
  });

  it('creates no planned date or clock in the display surfaces', () => {
    for (const file of NO_DATE_SURFACES) {
      const code = codeOf(file);
      expect(code, `${file} invents a date`).not.toContain('new Date(');
      expect(code, `${file} invents a planned date`).not.toContain('plannedDate');
      expect(code, `${file} builds a planned date`).not.toContain('createPlannedDate(');
      expect(code, `${file} persists something`).not.toContain('insert(');
      expect(code, `${file} mutates the calendar`).not.toContain('replaceAllForEnrollment');
    }

    // The affordance switch only forwards existing DTO values to existing forms.
    const controls = codeOf('src/features/schedule/components/ScheduleSlotControls.tsx');
    expect(controls).not.toContain('new Date(');
    expect(controls).not.toContain('createPlannedDate(');
    expect(controls).not.toContain('insert(');
  });
});

describe('M17 Slice 11 — M16 stays read-only and /completed stays M14-only', () => {
  it('M16 carries no record/undo form, action or settlement control', () => {
    for (const file of [M16_SECTION, M16_VIEW]) {
      const code = codeOf(file);
      expect(code, `${file} gained a settlement control`).not.toContain('RecordNotPerformedForm');
      expect(code).not.toContain('UndoNotPerformedForm');
      expect(code).not.toContain('recordNotPerformedAction');
      expect(code).not.toContain('undoNotPerformedAction');
      expect(code).not.toContain("Didn't train this");
      // Still counts only: no run-closure vocabulary leaks into the report.
      expect(code).not.toContain('isConcluded');
      expect(code).not.toContain('restartAvailable');
      expect(code).not.toContain('%');
    }
  });

  it('/completed asks only the M14 summary and knows nothing about closure or settlement', () => {
    for (const file of [COMPLETED_PAGE, COMPLETION_SUMMARY]) {
      const code = codeOf(file);
      expect(code).toContain(file === COMPLETED_PAGE ? 'getProgramCompletionSummaryUseCase' : 'isProgramComplete(');
      expect(code).not.toContain('getRunClosureSummaryUseCase');
      expect(code).not.toContain('RunClosure');
      expect(code).not.toContain('ConcludedRunCallout');
      expect(code).not.toContain('recordNotPerformed');
      expect(code).not.toContain('undoNotPerformed');
      expect(code).not.toContain('NotPerformedOccurrence');
    }
  });

  it('keeps the restart copy at the presentation boundary, code unchanged', () => {
    const code = codeOf(RESTART_ACTION);

    // The Application error CODE is never renamed…
    expect(code).toContain("'PROGRAM_NOT_COMPLETE'");
    // …and the Slice 11 wording replaces the M14 sentence for that code only.
    expect(code).toContain("This run hasn't finished yet.");
    expect(code).toContain('restartErrorMessage');
  });
});

describe('M17 Slice 11 — locked vocabulary', () => {
  it('uses the locked settlement copy on every surface that owns it', () => {
    expect(codeOf(STATUS_VIEW)).toContain("'Recorded as not performed'");
    expect(codeOf('src/features/schedule/components/RecordNotPerformedForm.tsx')).toContain(
      "Didn't train this",
    );
    expect(codeOf('src/features/schedule/components/UndoNotPerformedForm.tsx')).toContain(
      'label="Undo"',
    );
    expect(codeOf('src/features/schedule/components/UndoNotPerformedForm.tsx')).toContain(
      'It goes back to not started.',
    );
    expect(codeOf('src/features/enrollment/components/ConcludedRunCallout.tsx')).toContain(
      'Run closed —',
    );
    expect(codeOf(RESTART_ACTION)).toContain("This run hasn't finished yet.");
    // M17 final review: the settled-but-incomplete week badge.
    expect(codeOf('src/features/programs/components/ProgramWeekSection.tsx')).toContain(
      'Settled',
    );
  });

  it('never uses workout-level settlement vocabulary in the new surfaces', () => {
    const files = [
      ...SETTLEMENT_SURFACES,
      PANEL_STATE,
      STATUS_VIEW,
      // M17 final review: the week-status resolver and its badge.
      'src/features/programs/week-status.ts',
      'src/features/programs/components/ProgramWeekSection.tsx',
    ];
    const banned = /\b(skipped|missed|failed|incomplete)\b/i;

    for (const file of files) {
      const code = codeOf(file);
      const match = code.match(banned);
      expect(match, `${file} uses "${match?.[0] ?? ''}" as settlement vocabulary`).toBeNull();
    }
  });

  it('adds no confirmation dialog: Undo is the safety mechanism', () => {
    for (const file of SETTLEMENT_SURFACES) {
      const code = codeOf(file);
      expect(code).not.toContain('window.confirm');
      expect(code).not.toContain('confirm(');
    }
  });
});

describe('M17 final review — recorded identity and open/up-next truth', () => {
  const PROGRAM_DETAIL = 'src/features/programs/components/ProgramDetail.tsx';
  const PAGE = 'src/app/(app)/programs/[programSlug]/page.tsx';
  const NEXT_OCCURRENCE = 'src/features/enrollment/next-occurrence.ts';

  it('builds the recorded authored identity from BOTH planned N items and rowless unplaced N facts', () => {
    const code = codeOf(PROGRAM_DETAIL);

    // Planned not-performed rows and rowless recorded occurrences both feed the
    // SAME recorded key set — a rowless record is never left looking startable.
    expect(code).toContain("item.status === 'not-performed'");
    expect(code).toContain('schedule.schedule.unplacedNotPerformedWorkouts');
    expect(code).toContain('recordedKeys.add(');
    // The recorded fact is read from those DTOs, never inferred from a missing
    // session or a fabricated date.
    expect(code).not.toContain('plannedDate');
  });

  it('selects the up-next occurrence from the closure open identity, not completion-only nextWorkout', () => {
    const detail = codeOf(PROGRAM_DETAIL);
    const page = codeOf(PAGE);
    const helper = codeOf(NEXT_OCCURRENCE);

    // Both the view and the page route the next occurrence through the shared
    // helper…
    expect(detail).toContain('resolveRunNextOccurrence(');
    expect(page).toContain('resolveRunNextOccurrence(');
    // …which reads the Application's authored-run truth, never recomputing it.
    expect(helper).toContain('openInProgramOrder[0]');
    expect(helper).toContain('isProgramComplete');
    expect(helper).toContain('isConcluded');
    // React never recomputes openness itself.
    expect(detail).not.toContain('openInProgramOrder');
    expect(detail).not.toContain('isProgramComplete');
    expect(detail).not.toContain('isConcluded');
  });
});




describe('M17 final review — recorded state across the remaining workout surfaces', () => {
  const PROGRAM_DETAIL = 'src/features/programs/components/ProgramDetail.tsx';
  const WEEK_STATUS = 'src/features/programs/week-status.ts';
  const WEEK_SECTION = 'src/features/programs/components/ProgramWeekSection.tsx';
  const DASHBOARD_VIEW = 'src/features/dashboard/dashboard-view.ts';
  const DASHBOARD_USE_CASE = 'src/application/use-cases/get-current-program-dashboard.ts';
  const ACTIVE_VIEW = 'src/features/sessions/active-workout-view.ts';
  const RECORDED_PANEL = 'src/features/sessions/components/SessionRecordedPanel.tsx';
  const SESSION_PAGE =
    'src/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/page.tsx';

  it('(1) selects dashboard Up next from the closure open identity, never completion-only nextWorkout', () => {
    const view = codeOf(DASHBOARD_VIEW);

    // The view selects through the shared pure helper…
    expect(view).toContain('resolveRunNextOccurrence(');
    // …and the composition reads the M17 closure truth to feed it.
    expect(codeOf(DASHBOARD_USE_CASE)).toContain('getRunClosureSummary');
    // React/presentation never recomputes openness or closure itself.
    expect(view).not.toContain('openInProgramOrder');
    expect(view).not.toContain('isProgramComplete');
    expect(view).not.toContain('isConcluded');
    expect(view).not.toContain('resolveRunClosure');
  });

  it('(2) Program Detail week completion comes from authored completed truth, not nextOccurrence === null', () => {
    const detail = codeOf(PROGRAM_DETAIL);

    // The week status is delegated to the pure authored-truth resolver…
    expect(detail).toContain('resolveProgramWeekStatus(');
    // …and the old "settled run → all weeks completed" inference is gone.
    expect(detail).not.toContain("return 'completed';");
    // Presentation never derives a week verdict from a Domain closure call.
    expect(detail).not.toContain('isProgramComplete');
    expect(detail).not.toContain('isRunConcluded');
    expect(detail).not.toContain('resolveRunClosure(');
  });

  it('(3) a recorded occurrence never counts as completed for a week badge', () => {
    const code = codeOf(WEEK_STATUS);

    // Completion is decided ONLY by the completed-occurrence ids…
    expect(code).toContain('completedIds.has(occurrence.scheduledWorkoutId)');
    // …the settled state keys on the recorded identity, never on completion…
    expect(code).toContain('recordedKeys.has(occurrence.key)');
    expect(code).toContain("'settled'");
    // …and the factual badge exists without completion vocabulary.
    expect(codeOf(WEEK_SECTION)).toContain('Settled');
  });

  it('(4) rowless recorded occurrences participate in week truth by authored identity', () => {
    const detail = codeOf(PROGRAM_DETAIL);

    // Each week occurrence's recorded key is its AUTHORED "week-order"…
    expect(detail).toContain('`${week.weekNumber}-${scheduled.order}`');
    // …and the recorded set carries both planned N items and rowless facts.
    expect(detail).toContain('schedule.schedule.unplacedNotPerformedWorkouts');
  });

  it('(5) the active workout screen consumes notPerformedRecorded from the session use case', () => {
    const code = codeOf(ACTIVE_VIEW);

    expect(code).toContain('notPerformedRecorded');
    expect(code).toContain("'not-performed'");
    // The fact is read, never inferred from a missing session.
    expect(code).toContain('sessionResult.data');
  });

  it('(6) the recorded session screen exposes no Start control', () => {
    const code = codeOf(RECORDED_PANEL);

    // Revision: it reuses the recorded CTA band and renders no start panel.
    expect(code).toContain('ctaState="not-performed"');
    expect(code).not.toContain('SessionStartPanel');
    expect(code).not.toContain('StartSessionButton');
    // The session route renders the recorded panel for the recorded state.
    expect(codeOf(SESSION_PAGE)).toContain("screenState === 'not-performed'");
  });

  it('(7) Undo invalidates every nested route that renders the recorded state, from authored coordinates', () => {
    const undo = codeOf(UNDO_ACTION);

    // Both concrete nested routes that render the recorded CTA band — the
    // workout-detail route and its session route — are invalidated, each built
    // from the schema-validated authored coordinates (never a client path)…
    expect(undo).toContain('workoutPathFromRoute(parsed.data)');
    expect(undo).toContain('sessionPathFromRoute(parsed.data)');
    // …the top-level program + dashboard targets remain…
    expect(undo).toContain('programPathFromSlug(parsed.data.programSlug)');
    expect(undo).toContain("revalidatePath('/dashboard')");
    // …and no revalidation path is ever read from client form data.
    expect(undo).not.toContain('formData.get(');
    expect(undo).not.toContain('revalidatePath(form');
    expect(undo).not.toContain('redirect(');
  });

  it('(8) dashboard week summaries share the ONE authoritative open occurrence with Up next; a settled run has no current week', () => {
    const view = codeOf(DASHBOARD_VIEW);

    // Up next and the weekly summaries are fed by the SAME resolved occurrence…
    expect(view).toContain('resolveRunNextOccurrence(');
    expect(view).toContain('nextOccurrence === null ? null : nextOccurrence.weekNumber');
    // …the current week is selected once, and a concluded-but-incomplete run
    // yields none (no old recorded week is shown as current).
    expect(view).toContain('selectDashboardCurrentWeek(');
    expect(view).toContain("nextWorkoutPreview.status === 'concluded'");
    // React never recomputes openness or closure itself.
    expect(view).not.toContain('openInProgramOrder');
    expect(view).not.toContain('isProgramComplete');
    expect(view).not.toContain('isConcluded');
  });
});

