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

import { readFileSync } from 'node:fs';
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

describe('M17 Slice 8 — no M16 wiring and no presentation work', () => {
  it('leaves the M16 follow-through read and DTO untouched', () => {
    // Slice 9 owns M16 semantics: neither the application read nor its DTO may
    // mention the fact yet, even though the domain taxonomy already can.
    for (const file of [FOLLOW_THROUGH_READ, FOLLOW_THROUGH_DTO]) {
      expect(codeOf(file), `${file} already carries M16 fact wiring`).not.toMatch(/otPerformed/);
    }
  });

  it('adds no record/undo copy or control', () => {
    // The locked action copy and undo subtext belong to the presentation slice;
    // no M15 application module may carry them yet.
    for (const file of [SCHEDULE_DTO, SCHEDULE_READ, CONFIGURE, RESCHEDULE, DETAIL_READ]) {
      expect(read(file), `${file} carries action copy`).not.toContain("Didn't train");
      expect(read(file), `${file} carries undo copy`).not.toContain('goes back to not started');
    }
  });
});
