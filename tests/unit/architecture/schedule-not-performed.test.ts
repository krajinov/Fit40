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
    for (const file of M15_READERS) {
      const code = codeOf(file);

      // The one sanctioned read, on the read model port.
      expect(code, `${file} does not read the facts`).toContain(
        'notPerformedRepository.listByEnrollment(',
      );
      // Never the mutation authority, and never one of its writes.
      expect(code).not.toContain('RunOccurrenceWriteRepository');
      expect(code).not.toContain('runOccurrenceWrites');
      expect(code).not.toContain('recordNotPerformed');
      expect(code).not.toContain('undoNotPerformed');
      expect(code).not.toContain('createSessionForOccurrence');
      // No persistence, no SQL, no clock-free policy: these are reads plus one
      // planning write through the existing port.
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

describe('M17 Slice 9 — the M16 report READS the facts and never writes them', () => {
  it('reads the run facts once, through the read-only port', () => {
    const code = codeOf(FOLLOW_THROUGH_READ);

    // Exactly two reads: the planned rows, then the fact projection.
    expect(code.match(/listByEnrollment\(/g)).toHaveLength(2);
    expect(code).toContain('notPerformedRepository.listByEnrollment(');
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
