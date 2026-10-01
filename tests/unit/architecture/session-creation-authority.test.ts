/**
 * M17 Slice 6/7 — architecture guards for the ONE mutation authority and the
 * Application boundary around it.
 *
 * Source-level rather than behavioural: the invariants are the ABSENCE of a
 * second door ("no production INSERT into `workout_sessions` outside
 * `DrizzleRunOccurrenceWrites`", "no settlement decision evaluated outside the
 * locked transaction"), and a behavioural test cannot prove an absence. These
 * guards fail the moment one is re-opened.
 *
 * Comments are stripped before scanning, so the modules may keep documenting the
 * operations they do not expose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const SESSION_PORT = 'src/application/ports/workout-session-repository.ts';
const RUN_WRITE_PORT = 'src/application/ports/run-occurrence-write-repository.ts';
const NOT_PERFORMED_READ_PORT = 'src/application/ports/not-performed-occurrence-repository.ts';
const SESSION_REPOSITORY =
  'src/infrastructure/database/repositories/drizzle-workout-session-repository.ts';
const RUN_OCCURRENCE_WRITES =
  'src/infrastructure/database/repositories/drizzle-run-occurrence-writes.ts';
const SESSION_WRITES =
  'src/infrastructure/database/repositories/workout-session-writes.ts';
const NOT_PERFORMED_READ_REPOSITORY =
  'src/infrastructure/database/repositories/drizzle-not-performed-occurrence-repository.ts';
const DECISION = 'src/domain/services/not-performed-decision.ts';
const START_USE_CASE = 'src/application/use-cases/start-workout-session.ts';
const RECORD_USE_CASE = 'src/application/use-cases/record-not-performed.ts';
const UNDO_USE_CASE = 'src/application/use-cases/undo-not-performed.ts';
const SCHEDULE_SERVICES = 'src/features/schedule/services.ts';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

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

describe('M17 Slice 6 — one workout-session creation authority', () => {
  it('declares createSessionForOccurrence on the run-occurrence write port only', () => {
    expect(read(RUN_WRITE_PORT)).toContain('createSessionForOccurrence');

    // The session port must not re-declare creation in any form.
    expect(codeOf(SESSION_PORT)).not.toMatch(/\bcreate\s*\(/);
    expect(codeOf(SESSION_PORT)).not.toContain('createSessionForOccurrence');
  });

  it('keeps every production INSERT into workout_sessions inside the write authority', () => {
    // The only INSERT of a session row in production source is the extracted
    // INSERT half, called by the transaction owner.
    expect(codeOf(SESSION_WRITES)).toContain('insert(workoutSessions)');
    expect(codeOf(RUN_OCCURRENCE_WRITES)).toContain('insertWorkoutSessionRows');
    expect(codeOf(SESSION_REPOSITORY)).not.toContain('insert(workoutSessions)');
    expect(codeOf(SESSION_REPOSITORY)).toContain('update(workoutSessions)');
  });

  it('never writes a session with an upsert', () => {
    for (const file of [SESSION_WRITES, RUN_OCCURRENCE_WRITES, SESSION_REPOSITORY]) {
      expect(codeOf(file)).not.toContain('onConflictDoUpdate');
    }
  });

  it('routes the start path through the serialized authority, not the session repository', () => {
    const useCase = codeOf(START_USE_CASE);

    expect(useCase).toContain('createSessionForOccurrence');
    expect(useCase).not.toContain('WorkoutSessionRepository');
    expect(useCase).not.toMatch(/\.create\s*\(/);
  });

  it('keeps exactly one enrollment-lock implementation for session creation', () => {
    const writes = codeOf(RUN_OCCURRENCE_WRITES);

    expect(writes).toContain("for('no key update')");
    // The session write helper takes a transaction; it must never open one or
    // take the lock itself, so the lock order stays owned by one module.
    expect(codeOf(SESSION_WRITES)).not.toContain("for('no key update')");
    expect(codeOf(SESSION_WRITES)).not.toContain('transaction(');
  });
});

describe('M17 Slice 7 — Application never decides settlement policy', () => {
  it('evaluates the settlement decisions only inside the locked authority', () => {
    const files = sourceFiles();
    const decisionSites = files.filter((file) =>
      /decide(Record|Undo)NotPerformed\s*\(/.test(codeOf(file)),
    );

    // Exactly two: the Domain definition (with its unit tests, which are not in
    // `src`) and the transaction owner that evaluates it under the lock.
    expect([...decisionSites].sort()).toEqual([DECISION, RUN_OCCURRENCE_WRITES].sort());

    // And the port only NAMES the decision in prose: Application must not call it.
    for (const file of files) {
      if (!file.startsWith('src/application/')) continue;
      expect(codeOf(file), `${file} calls a settlement decision`).not.toMatch(
        /decide(Record|Undo)NotPerformed\s*\(/,
      );
    }
  });

  it('keeps the not-performed read model read-only', () => {
    expect(codeOf(NOT_PERFORMED_READ_PORT)).not.toMatch(
      /recordNotPerformed|undoNotPerformed|createSessionForOccurrence/,
    );
    expect(codeOf(NOT_PERFORMED_READ_REPOSITORY)).not.toMatch(/\b(insert|delete|update)\(/);
  });

  it('writes not-performed facts only inside the locked authority', () => {
    const writers = sourceFiles().filter((file) =>
      /(insert|delete)\(notPerformedWorkouts\)/.test(codeOf(file)),
    );

    expect(writers).toEqual([RUN_OCCURRENCE_WRITES]);
  });

  it('keeps the record and undo use cases resolver-and-translator only', () => {
    const cases = [
      { file: RECORD_USE_CASE, call: 'recordNotPerformed(', portMethod: 'undoNotPerformed(' },
      { file: UNDO_USE_CASE, call: 'undoNotPerformed(', portMethod: 'recordNotPerformed(' },
    ] as const;

    for (const { file, call, portMethod } of cases) {
      const code = codeOf(file);

      // The one mutation this use case is allowed to request — and not the
      // sibling one, which belongs to the other operation.
      expect(code).toContain(call);
      expect(code).not.toContain(portMethod);
      expect(code).not.toContain('createSessionForOccurrence');

      // No policy, no persistence, no clock, no regeneration, no session reads:
      // identity resolution plus outcome translation is the whole job.
      expect(code).not.toContain('decide');
      expect(code).not.toContain('drizzle');
      expect(code).not.toContain('schema');
      expect(code).not.toContain('transaction');
      expect(code).not.toContain('WorkoutSessionRepository');
      expect(code).not.toContain('notPerformedOccurrenceRepository');
      expect(code).not.toContain('PlannedWorkoutRepository');
      expect(code).not.toContain('replaceAllForEnrollment');
      expect(code).not.toContain('generatePlannedSchedule');
      expect(code).not.toContain('new Date');
      expect(code).not.toContain('Date.now');
    }
  });

  it('shares the ONE mutation-authority instance with session creation', () => {
    const services = codeOf(SCHEDULE_SERVICES);

    expect(services).toContain('runOccurrenceWrites');
    expect(services).toContain('RecordNotPerformedUseCase');
    expect(services).toContain('UndoNotPerformedUseCase');
    // Never constructed here: the singleton lives in the repository index, so
    // record, undo and start share one instance and one lock discipline.
    expect(services).not.toContain('DrizzleRunOccurrenceWrites');
  });
});

describe('M17 Slice 13 — the write port shape and the lock-before-read order', () => {
  /** The stripped body of one settlement method, bounded by its neighbours. */
  function methodBody(
    code: string,
    signature: string,
    nextSignature: string | null,
  ): string {
    const start = code.indexOf(signature);
    expect(start, `${signature} not found`).toBeGreaterThan(0);
    const end = nextSignature === null ? code.length : code.indexOf(nextSignature, start + 1);
    expect(end, `${signature} has no end boundary`).toBeGreaterThan(start);
    return code.slice(start, end);
  }

  it('declares exactly the three settlement operations on the write port — and nowhere else', () => {
    const port = codeOf(RUN_WRITE_PORT);
    const start = port.indexOf('export interface RunOccurrenceWriteRepository {');
    expect(start).toBeGreaterThan(0);
    const body = port.slice(start, port.indexOf('\n}', start));

    const methods = [...body.matchAll(/^ {2}(\w+)\s*\(/gm)].map((match) => match[1]);
    expect([...methods].sort()).toEqual([
      'createSessionForOccurrence',
      'recordNotPerformed',
      'undoNotPerformed',
    ]);

    // No other port interface may re-declare a settlement operation, in any form.
    for (const file of sourceFiles('src/application/ports')) {
      if (file === RUN_WRITE_PORT) continue;
      expect(codeOf(file), `${file} declares a settlement operation`).not.toMatch(
        /recordNotPerformed\s*\(|undoNotPerformed\s*\(|createSessionForOccurrence\s*\(/,
      );
    }
  });

  it('locks the parent enrollment BEFORE every diagnostic read in all three methods', () => {
    const code = codeOf(RUN_OCCURRENCE_WRITES);
    const lock = ".for('no key update')";

    const record = methodBody(code, 'async recordNotPerformed(', 'async undoNotPerformed(');
    const undo = methodBody(code, 'async undoNotPerformed(', 'async createSessionForOccurrence(');
    const create = methodBody(code, 'async createSessionForOccurrence(', null);

    // record: lock → diagnostic facts → Domain decision → guarded DELETE → fact INSERT.
    const order = [
      record.indexOf(lock),
      record.indexOf('readSettlementFacts(tx, input)'),
      record.indexOf('decideRecordNotPerformed('),
      record.indexOf('delete(workoutSessions)'),
      record.indexOf('insert(notPerformedWorkouts)'),
    ];
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // undo: lock → fact read → Domain decision → fact DELETE.
    const undoOrder = [
      undo.indexOf(lock),
      undo.indexOf('from(notPerformedWorkouts)'),
      undo.indexOf('decideUndoNotPerformed('),
      undo.indexOf('delete(notPerformedWorkouts)'),
    ];
    expect(undoOrder.every((index) => index > 0)).toBe(true);
    expect([...undoOrder].sort((a, b) => a - b)).toEqual(undoOrder);

    // create: lock → recorded-fact check → session INSERT.
    const createOrder = [
      create.indexOf(lock),
      create.indexOf('from(notPerformedWorkouts)'),
      create.indexOf('insertWorkoutSessionRows('),
    ];
    expect(createOrder.every((index) => index > 0)).toBe(true);
    expect([...createOrder].sort((a, b) => a - b)).toEqual(createOrder);

    // Exactly three lock sites — one per method, none anywhere else.
    expect(code.match(/\.for\('no key update'\)/g)).toHaveLength(3);
  });

  it('pins the diagnosed session version on the guarded DELETE', () => {
    const code = codeOf(RUN_OCCURRENCE_WRITES);
    const record = methodBody(code, 'async recordNotPerformed(', 'async undoNotPerformed(');

    // The diagnostic read selects the token…
    expect(code).toContain('sessionVersion: workoutSessions.version');
    // …and the guarded DELETE pins it, between the delete and the fact insert.
    const deleteIndex = record.indexOf('delete(workoutSessions)');
    const pinIndex = record.indexOf('eq(workoutSessions.version, lockedFacts.sessionVersion)');
    const insertIndex = record.indexOf('insert(notPerformedWorkouts)');
    expect(deleteIndex).toBeGreaterThan(0);
    expect(pinIndex).toBeGreaterThan(deleteIndex);
    expect(insertIndex).toBeGreaterThan(pinIndex);
    // The other safety predicates ride along unchanged.
    expect(record).toContain('isNull(workoutSessions.completedAt)');
    expect(record).toContain('not exists (select 1 from');
    // Zero affected rows after an authorized write is a thrown violation, never
    // a swallowed business outcome.
    expect(record).toContain('RunOccurrenceWriteContractViolationError');
  });

  it('runs no retry loop: one transaction, one decision, one mutation per call', () => {
    // The transaction module has no loop construct at all (`.for('…')` is a
    // row-lock clause, not a `for` statement — the lookbehind makes the
    // distinction structural, not textual).
    const writes = codeOf(RUN_OCCURRENCE_WRITES);
    expect(writes).not.toMatch(/(?<![.\w$])for\s*\(/);
    expect(writes).not.toMatch(/while\s*\(/);
    expect(writes).not.toContain('do {');

    // Each use case requests its ONE mutation exactly once and loops nothing.
    const cases = [
      { file: RECORD_USE_CASE, call: /\.recordNotPerformed\(/g },
      { file: UNDO_USE_CASE, call: /\.undoNotPerformed\(/g },
    ] as const;
    for (const { file, call } of cases) {
      const code = codeOf(file);
      expect(code.match(call), `${file} mutation call count`).toHaveLength(1);
      expect(code).not.toMatch(/(?<![.\w$])for\s*\(/);
      expect(code).not.toMatch(/while\s*\(/);
    }
  });
  // M17-S13-ANCHOR
});

describe('M17 Slice 13 — start wiring and the no-resurrection backstop', () => {
  const SESSIONS_SERVICES = 'src/features/sessions/services.ts';
  const REPOSITORY_INDEX = 'src/infrastructure/database/repositories/index.ts';

  it('wires start through the shared authority from the sessions composition root', () => {
    // Whitespace-normalized so the assertion is about the arguments, not the
    // formatter's line breaks.
    const services = codeOf(SESSIONS_SERVICES).replace(/\s+/g, ' ');

    expect(services).toMatch(
      /new StartWorkoutSessionUseCase\(\s*programRepository,\s*runOccurrenceWrites,/,
    );
    expect(services).not.toContain('DrizzleRunOccurrenceWrites');
    expect(services).not.toContain('insert(workoutSessions)');

    // The singleton itself is constructed exactly once, in the repository index.
    const constructors = sourceFiles().filter((file) =>
      codeOf(file).includes('new DrizzleRunOccurrenceWrites('),
    );
    expect(constructors).toEqual([REPOSITORY_INDEX]);
  });

  it('never upserts a workout session anywhere in production source', () => {
    // The ONE INSERT site…
    const inserters = sourceFiles().filter((file) =>
      codeOf(file).includes('insert(workoutSessions)'),
    );
    expect(inserters).toEqual([SESSION_WRITES]);
    // …carries no conflict clause at all, and neither does the update-only
    // session repository: a deleted session row can never be resurrected.
    expect(codeOf(SESSION_WRITES)).not.toMatch(/onConflict/);
    expect(codeOf(SESSION_REPOSITORY)).not.toMatch(/onConflict/);

    // The transaction module's single conflict clause is the I1 primary-key
    // backstop on the FACT insert — never on a session row.
    const writes = codeOf(RUN_OCCURRENCE_WRITES);
    const clauses = writes.match(/onConflict\w*/g) ?? [];
    expect(clauses).toEqual(['onConflictDoNothing']);
    const factInsert = writes.indexOf('insert(notPerformedWorkouts)');
    const clause = writes.indexOf('onConflictDoNothing');
    expect(factInsert).toBeGreaterThan(0);
    expect(clause).toBeGreaterThan(factInsert);
    expect(writes).not.toContain('insert(workoutSessions)');
    expect(writes).not.toMatch(/onConflictDoUpdate/);
  });
});
