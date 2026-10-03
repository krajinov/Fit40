/**
 * M17 Slice 8 — architecture guards for the M15 calendar's use of the
 * not-performed fact.
 *
 * Source-level rather than behavioural: the invariants are about which READ a
 * calendar/configuration path may use and which WRITE it may never reach. The
 * fact's own mutation authority is guarded in
 * `session-creation-authority.test.ts`; these guards cover the M15 read side and
 * the slice's deliberate absence of M16 wiring.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const SCHEDULE_READ = 'src/application/use-cases/get-enrollment-schedule.ts';
const CONFIGURE = 'src/application/use-cases/configure-training-days.ts';
const RESCHEDULE = 'src/application/use-cases/reschedule-planned-workout.ts';
const DETAIL_READ = 'src/application/use-cases/get-workout-session.ts';
const SCHEDULE_DTO = 'src/application/dto/schedule.ts';
const FOLLOW_THROUGH_READ = 'src/application/use-cases/get-enrollment-follow-through.ts';
const FOLLOW_THROUGH_DTO = 'src/application/dto/follow-through.ts';
const FOLLOW_THROUGH_VIEW = 'src/features/schedule/follow-through-view.ts';

/** Every M15 path that may legitimately read the not-performed facts. */
const M15_READERS = [SCHEDULE_READ, CONFIGURE, RESCHEDULE, DETAIL_READ];

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

describe('M17 Slice 8 — the M15 calendar only READS the not-performed facts', () => {
  it('reads the run facts through the read-only port and nothing else', () => {
    // The mutation/configuration paths keep the one sanctioned fact read on
    // the read model port.
    for (const file of [CONFIGURE, RESCHEDULE]) {
      const code = codeOf(file);

      expect(code, `${file} does not read the facts`).toContain(
        'notPerformedRepository.listByEnrollment(',
      );
    }
    // The two pure read surfaces take ONE coherent snapshot instead: session
    // execution truth and settlement facts are mutually exclusive per
    // occurrence, so they must never be assembled from independently mutable
    // reads that could tear across a concurrent settlement transition.
    for (const file of [SCHEDULE_READ, DETAIL_READ]) {
      const code = codeOf(file);

      expect(code, `${file} coordinates two independently mutable reads`).not.toContain(
        'notPerformedRepository',
      );
    }
    // Every M15 reader: never the mutation authority, never one of its
    // writes, no persistence, no SQL, no transaction.
    for (const file of M15_READERS) {
      const code = codeOf(file);

      expect(code).not.toContain('RunOccurrenceWriteRepository');
      expect(code).not.toContain('runOccurrenceWrites');
      expect(code).not.toContain('recordNotPerformed');
      expect(code).not.toContain('undoNotPerformed');
      expect(code).not.toContain('createSessionForOccurrence');
      expect(code).not.toContain('drizzle');
      expect(code).not.toContain("from '../schema'");
      expect(code).not.toContain('transaction(');
    }
  });

  it('never inserts or deletes a not-performed fact from a schedule path', () => {
    for (const file of M15_READERS) {
      const code = codeOf(file);
      expect(code).not.toContain('insert(');
      expect(code).not.toContain('delete(');
    }
    // The DTO projection carries no persistence capability at all.
    expect(codeOf(SCHEDULE_DTO)).not.toContain('notPerformedWorkouts');
  });

  it('synthesizes no planned row for an unplaced recorded occurrence', () => {
    const code = codeOf(SCHEDULE_READ);

    // The projection is a pure derivation over two reads.
    expect(code).toContain('projectUnplacedNotPerformed');
    expect(code).toContain('recordedAtIso: fact.recordedAt.toISOString()');
    // No synthetic row, no planning write.
    expect(code).not.toContain('createPlannedWorkout');
    expect(code).not.toContain('mapPlannedWorkoutToRow');
    expect(code).not.toContain('replaceAllForEnrollment');

    // Inside the projection itself there is no date at all: dated rows are the
    // separate, legitimate `toPlannedWorkoutDto` path.
    const projection = code.slice(code.indexOf('function projectUnplacedNotPerformed'));
    const projectionBody = projection.slice(0, projection.indexOf('\n}\n') + 3);
    expect(projectionBody).not.toContain('plannedDate');
    expect(projectionBody).not.toContain('PlannedWorkout');

    // The unplaced DTO exposes authored labels and the recorded instant only.
    const dto = read(SCHEDULE_DTO);
    const start = dto.indexOf('export interface UnplacedNotPerformedWorkoutDto');
    const unplacedDto = dto.slice(start, dto.indexOf('}\n', start) + 2);
    expect(unplacedDto).toContain('readonly scheduledWorkoutId: string;');
    expect(unplacedDto).toContain('readonly weekNumber: number;');
    expect(unplacedDto).toContain('readonly workoutOrder: number;');
    expect(unplacedDto).toContain('readonly workoutName: string;');
    expect(unplacedDto).toContain('readonly recordedAtIso: string;');
    expect(unplacedDto).not.toContain('plannedDate');
    expect(unplacedDto).not.toContain('status');
  });

  it('wires only the read model into the calendar paths and the authority into the writers', () => {
    const services = codeOf('src/features/schedule/services.ts');

    expect(services).toContain('notPerformedOccurrenceRepository');
    expect(services).toContain('runOccurrenceWrites');
    // The record/undo use cases take the write authority; the reads never do.
    expect(services).toContain('recordNotPerformedUseCase = new RecordNotPerformedUseCase');
    expect(services).toContain('undoNotPerformedUseCase = new UndoNotPerformedUseCase');
  });
});

describe('M17 snapshot reads — execution truth and settlement facts are ONE coherent snapshot', () => {
  const OCCURRENCE_ADAPTER =
    'src/infrastructure/database/repositories/drizzle-occurrence-execution-facts-repository.ts';
  const SCHEDULE_ADAPTER =
    'src/infrastructure/database/repositories/drizzle-schedule-execution-facts-repository.ts';
  const SCHEDULE_SERVICES = 'src/features/schedule/services.ts';
  const SESSION_SERVICES = 'src/features/sessions/services.ts';

  it('the schedule read takes ONE snapshot for session execution truth and settlement facts', () => {
    const code = codeOf(SCHEDULE_READ);

    expect(code).toContain(
      'scheduleExecutionFactsRepository.listScheduleExecutionFactsByEnrollment(',
    );
    expect(code.match(/listScheduleExecutionFactsByEnrollment\(/g)).toHaveLength(1);
    // Never the retired independently mutable projections.
    expect(code).not.toContain('listCompletedScheduledWorkoutIds(');
    expect(code).not.toContain('listInProgressScheduledWorkoutIds(');
    // Calendar intent stays the separate, documented read.
    expect(code).toContain('plannedWorkoutRepository.listByEnrollment(');
  });

  it('the occurrence detail read takes ONE snapshot for session and settlement state', () => {
    const code = codeOf(DETAIL_READ);

    expect(code).toContain(
      'occurrenceExecutionFactsRepository.findOccurrenceExecutionFacts(',
    );
    expect(code.match(/findOccurrenceExecutionFacts\(/g)).toHaveLength(1);
    expect(code).not.toContain('Promise.all(');
    expect(code).not.toContain('findByEnrollmentAndScheduledWorkout(');
  });

  it('the schedule projection is ONE statement — no transaction, no lock, no writes', () => {
    const adapter = codeOf(SCHEDULE_ADAPTER);

    expect(adapter).toContain('.unionAll(');
    expect(adapter.match(/await /g)).toHaveLength(1);
    expect(adapter).not.toContain('transaction(');
    expect(adapter).not.toContain(".for('");
    expect(adapter).not.toContain('insert(');
    expect(adapter).not.toContain('update(');
    expect(adapter).not.toContain('delete(');
  });

  it('the occurrence projection is ONE bounded read-only REPEATABLE READ transaction', () => {
    const adapter = codeOf(OCCURRENCE_ADAPTER);

    expect(adapter.match(/transaction\(/g)).toHaveLength(1);
    expect(adapter).toContain("isolationLevel: 'repeatable read'");
    expect(adapter).toContain("accessMode: 'read only'");
    expect(adapter).not.toContain('serializable');
    expect(adapter).not.toContain(".for('");
    expect(adapter).not.toContain('insert(');
    expect(adapter).not.toContain('update(');
    expect(adapter).not.toContain('delete(');
  });

  it('the follow-through projection is ONE statement — no transaction, no lock, no writes', () => {
    const adapter = codeOf(
      'src/infrastructure/database/repositories/drizzle-follow-through-execution-facts-repository.ts',
    );

    // ONE statement takes ONE snapshot, so completed activity and the recorded
    // facts can never be torn across a concurrent settlement transition.
    expect(adapter).toContain('.unionAll(');
    expect(adapter.match(/await /g)).toHaveLength(1);
    expect(adapter).not.toContain('transaction(');
    expect(adapter).not.toContain(".for('");
    expect(adapter).not.toContain('insert(');
    expect(adapter).not.toContain('update(');
    expect(adapter).not.toContain('delete(');
  });

  it('wires the snapshot ports into the schedule and session composition roots', () => {
    const schedule = codeOf(SCHEDULE_SERVICES).replace(/\s+/g, ' ');
    expect(schedule).toMatch(
      /new GetEnrollmentScheduleUseCase\(\s*programEnrollmentRepository,\s*plannedWorkoutRepository,\s*scheduleExecutionFactsRepository,/,
    );

    const sessions = codeOf(SESSION_SERVICES).replace(/\s+/g, ' ');
    expect(sessions).toMatch(
      /new GetWorkoutSessionUseCase\(\s*programRepository,\s*programEnrollmentRepository,\s*occurrenceExecutionFactsRepository,/,
    );
  });
});

describe('M17 Slice 9 — the M16 report READS the facts and never writes them', () => {
  it('reads the run facts through the read-only port, once per terminal path', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);

    // The planned-row intent read: exactly one.
    expect(code.match(/plannedWorkoutRepository\.listByEnrollment\(/g)).toHaveLength(1);
    // The fact projection: ONE read on the no-calendar terminal path only
    // (so a rowless fact is still counted) — the configured path takes the
    // one-snapshot execution-facts port instead. Never one query per row or
    // per fact, and always a READ-ONLY port.
    expect(code.match(/notPerformedRepository\.listByEnrollment\(/g)).toHaveLength(1);
    expect(code).toContain(
      'followThroughExecutionFactsRepository.listFollowThroughExecutionFactsByEnrollment(',
    );
    // The configured path never coordinates independently mutable reads.
    expect(code).not.toContain('listCompletedOccurrenceActivity(');
    expect(code).not.toContain('listInProgressScheduledWorkoutIds(');
    // Never the mutation authority, and never one of its writes.
    expect(code).not.toContain('RunOccurrenceWriteRepository');
    expect(code).not.toContain('runOccurrenceWrites');
    expect(code).not.toContain('recordNotPerformed');
    expect(code).not.toContain('undoNotPerformed');
    expect(code).not.toContain('createSessionForOccurrence');
    // No persistence, no SQL, no transaction: the report is a read.
    expect(code).not.toContain('drizzle');
    expect(code).not.toContain('insert(');
    expect(code).not.toContain('delete(');
    expect(code).not.toContain('transaction(');
  });

  it('reads N facts for an ACTIVE enrollment even when there are no planned rows', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);
    const zeroRowBranch = code.indexOf('if (plannedRows.length === 0)');
    const factReadInBranch = code.indexOf('notPerformedRepository.listByEnrollment(', zeroRowBranch);
    const unconfiguredBuild = code.indexOf('toUnconfiguredFollowThroughDto(', zeroRowBranch);

    // The no-calendar path is NOT a fact-read short-circuit: it reads the run's
    // facts so a rowless record is still counted, and only then builds the
    // unconfigured DTO.
    expect(zeroRowBranch).toBeGreaterThan(0);
    expect(factReadInBranch).toBeGreaterThan(zeroRowBranch);
    expect(unconfiguredBuild).toBeGreaterThan(factReadInBranch);

    // The unconfigured DTO exposes the factual count (never a synthesized zero
    // beside a variant that claims there is nothing to report).
    const dto = codeOf(FOLLOW_THROUGH_DTO);
    const start = dto.indexOf('export interface UnconfiguredFollowThroughDto');
    const body = dto.slice(start, dto.indexOf('}\n', start));
    expect(body).toContain('readonly notPerformedUnplaced: number;');
  });

  it('holds the 8-week horizon constant and never widens it for a fact', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);

    expect(code).toContain('export const FOLLOW_THROUGH_WEEK_COUNT = 8;');
    expect(code).toContain(
      'listRecentTrainingWeekWindows(input.now, FOLLOW_THROUGH_WEEK_COUNT)',
    );
    // The only window construction, with no literal span of its own.
    expect(code).not.toMatch(/listRecentTrainingWeekWindows\([^)]*\d/);
  });

  it('appends no occurrence for a rowless fact: the spine is the planned rows', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);
    const assemble = code.slice(code.indexOf('function assembleOccurrences'));

    // Exactly one returned occurrence array, built by mapping the rows — the
    // facts only build a lookup Set and never contribute an entry of their own.
    const returns = assemble.match(/return [^;]+;/g);
    expect(returns).toHaveLength(1);
    expect(returns?.[0]).toContain('plannedRows.map(');
    expect(assemble).toContain('const recorded = new Set<ScheduledWorkoutId>(');
    expect(assemble).not.toContain('push(');
    expect(assemble).not.toContain('concat');
    // The facts only mark the rows that exist.
    expect(assemble).toContain(
      'hasNotPerformedRecord: recorded.has(plannedWorkout.scheduledWorkoutId)',
    );
  });

  it('derives notPerformedUnplaced from facts MINUS current planned rows, before summarizing', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);
    const derived = code.indexOf('countUnplacedFacts(');
    const summarized = code.indexOf('summarizeFollowThrough(');
    const windowed = code.indexOf('listRecentTrainingWeekWindows(');

    expect(derived).toBeGreaterThan(0);
    expect(summarized).toBeGreaterThan(0);
    // Independent of the report: counted before any window or summary exists.
    expect(derived).toBeLessThan(summarized);
    expect(derived).toBeLessThan(windowed);

    const helper = code.slice(code.indexOf('function countUnplacedFacts'));
    const helperBody = helper.slice(0, helper.indexOf('\n}\n') + 3);
    expect(helperBody).toContain('plannedRows.map((row) => row.scheduledWorkoutId)');
    expect(helperBody).toContain('!occurrenceIdsWithRows.has(fact.scheduledWorkoutId)');
    // A row difference only: no date, no week, no horizon can enter the count.
    expect(helperBody).not.toContain('plannedDate');
    expect(helperBody).not.toContain('weekStart');
    expect(helperBody).not.toContain('Window');
  });

  it('carries a count, not a second labelled list, in the report DTO', () => {
    const dto = codeOf(FOLLOW_THROUGH_DTO);

    expect(dto).toContain('readonly notPerformed: number;');
    expect(dto).toContain('readonly notPerformedUnplaced: number;');
    // The labelled collection belongs to the M15 calendar read, not here.
    expect(dto).not.toContain('NotPerformedWorkoutDto');
    expect(dto).not.toContain('scheduledWorkoutId');
    expect(dto).not.toContain('recordedAtIso');
  });

  it('keeps the record action, its undo and run closure out of the report', () => {
    for (const file of [FOLLOW_THROUGH_READ, FOLLOW_THROUGH_DTO, FOLLOW_THROUGH_VIEW]) {
      const code = codeOf(file);
      expect(code).not.toContain('RecordNotPerformedUseCase');
      expect(code).not.toContain('UndoNotPerformedUseCase');
      // Slice 10 owns run closure; no earlier slice may imply it.
      expect(code).not.toContain('isRunConcluded');
      expect(code).not.toContain('restartProgram');
    }
  });

  it('adds no record/undo copy or control anywhere yet', () => {
    // The locked action copy and undo subtext belong to the presentation slice;
    // no application module or follow-through view may carry them yet.
    for (const file of [
      SCHEDULE_DTO,
      SCHEDULE_READ,
      CONFIGURE,
      RESCHEDULE,
      DETAIL_READ,
      FOLLOW_THROUGH_VIEW,
    ]) {
      expect(read(file), `${file} carries action copy`).not.toContain("Didn't train");
      expect(read(file), `${file} carries undo copy`).not.toContain('goes back to not started');
    }
  });
});

describe('M17 Slice 13 — recorded facts enter generation as the settled input', () => {
  const GENERATION = 'src/domain/services/planned-schedule.ts';

  it('hands notPerformedIds from the configure read into generatePlannedSchedule', () => {
    const code = codeOf(CONFIGURE);

    expect(code).toContain('generatePlannedSchedule({');
    expect(code).toContain(
      'notPerformedIds: notPerformedFacts.map((fact) => fact.scheduledWorkoutId)',
    );
    // The facts come from the read-only port, never from a write authority.
    expect(code).toContain('this.notPerformedRepository.listByEnrollment(');
    expect(code).not.toContain('runOccurrenceWrites');
    expect(code).not.toContain('recordNotPerformed');
    expect(code).not.toContain('undoNotPerformed');
  });

  it('declares notPerformedIds on the generation input and unions it into settled', () => {
    const code = codeOf(GENERATION);

    // The input field, documented as the no-op default it is.
    expect(code).toContain('readonly notPerformedIds?: ReadonlyArray<ScheduledWorkoutId>;');
    // The partition unions it with completed ids — ONE settled set — before the
    // occurrence walk, so a recorded occurrence can never receive a row.
    const settledIndex = code.indexOf('const settled = new Set<ScheduledWorkoutId>([');
    expect(settledIndex).toBeGreaterThan(0);
    const settledBlock = code.slice(settledIndex, code.indexOf(']);', settledIndex));
    expect(settledBlock).toContain('...input.completedIds,');
    expect(settledBlock).toContain('...(input.notPerformedIds ?? [])');
    const walkIndex = code.indexOf('settled.has(occurrence.id)');
    expect(walkIndex).toBeGreaterThan(settledIndex);
  });

  it('is called from exactly one production site: the configure use case', () => {
    /** Every production TypeScript module under `src`, as repository-relative paths. */
    function sourceFiles(directory = 'src'): ReadonlyArray<string> {
      const entries = readdirSync(path.join(ROOT, directory), { withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          files.push(...sourceFiles(relative));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(relative);
        }
      }

      return files;
    }

    const callers = sourceFiles().filter((file) =>
      codeOf(file).includes('generatePlannedSchedule('),
    );
    expect([...callers].sort()).toEqual([CONFIGURE, GENERATION].sort());
  });
});

describe('M17 final review — settlement is re-checked under the reschedule lock', () => {
  const RESCHEDULE_PORT = 'src/application/ports/planned-workout-repository.ts';
  const DRIZZLE_PLANNED =
    'src/infrastructure/database/repositories/drizzle-planned-workout-repository.ts';

  it('makes reschedule return a typed settlement outcome, not a bare success', () => {
    const port = codeOf(RESCHEDULE_PORT);

    expect(port).toContain('PlannedWorkoutRescheduleOutcome');
    expect(port).toContain("'recorded-not-performed'");
    expect(port).toContain('Promise<PlannedWorkoutRescheduleOutcome>');
  });

  it('reads the fact UNDER the enrollment lock and BEFORE any planned write', () => {
    const repo = codeOf(DRIZZLE_PLANNED);

    expect(repo).toContain('notPerformedWorkouts');
    const lockAt = repo.indexOf("for('no key update')");
    const factAt = repo.indexOf('from(notPerformedWorkouts)');
    const updateAt = repo.indexOf('.update(plannedWorkouts)');

    expect(lockAt).toBeGreaterThan(-1);
    expect(factAt).toBeGreaterThan(lockAt);
    expect(updateAt).toBeGreaterThan(factAt);
  });

  it('maps the under-lock refusal to the existing typed application error', () => {
    const useCase = codeOf(RESCHEDULE);

    expect(useCase).toContain("outcome.outcome === 'recorded-not-performed'");
    expect(useCase).toContain('occurrenceRecordedNotPerformed(');
    // The use case still owns no transaction: the lock lives in the repository.
    expect(useCase).not.toContain('transaction(');
  });
});

describe('M17 final review — recorded truth flows through the next-workout preview', () => {
  const RESOLVE_NEXT = 'src/application/use-cases/resolve-next-workout.ts';
  const NEXT_DTO_MODULE = 'src/application/dto/dashboard.ts';
  const NEXT_CARD = 'src/features/dashboard/components/NextWorkoutCard.tsx';
  const PANEL = 'src/features/enrollment/components/EnrolledProgramPanel.tsx';

  it('resolves the recorded state from the user-scoped session read, never a client flag', () => {
    const code = codeOf(RESOLVE_NEXT);

    expect(code).toContain('sessionResult.data.notPerformedRecorded');
    expect(code).toContain("'not-performed'");
    // It depends only on use-case ports — no repository, no ORM, no query.
    expect(code).not.toContain('Repository');
    expect(code).not.toContain('drizzle');

    // The input carries no settlement field a client could set.
    const inputStart = code.indexOf('export interface ResolveNextWorkoutInput');
    const input = code.slice(inputStart, code.indexOf('}', inputStart) + 1);
    expect(input).not.toContain('notPerformed');
    expect(input).not.toContain('recorded');
  });

  it('represents the recorded preview as an explicit state, never not-started', () => {
    expect(codeOf(NEXT_DTO_MODULE)).toContain("'not-performed'");
    expect(codeOf('src/features/sessions/next-workout-view.ts')).toContain("'not-performed'");
  });

  it('offers no Start/Resume on the recorded preview surfaces', () => {
    expect(codeOf(NEXT_CARD)).toContain('Recorded as not performed');
    expect(codeOf(PANEL)).toContain('Recorded as not performed');
  });
});
