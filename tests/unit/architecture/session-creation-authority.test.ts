/**
 * M17 Slice 6 — architecture guard for the ONE workout-session creation
 * authority.
 *
 * Source-level rather than behavioural: the invariant this slice buys is
 * "there is no production INSERT into `workout_sessions` outside
 * `DrizzleRunOccurrenceWrites`", and a behavioural test cannot prove the
 * absence of a second door. These guards fail the moment one is re-opened.
 *
 * Comments are stripped before scanning, so the modules may keep documenting the
 * operations they no longer expose.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const SESSION_PORT = 'src/application/ports/workout-session-repository.ts';
const RUN_WRITE_PORT = 'src/application/ports/run-occurrence-write-repository.ts';
const SESSION_REPOSITORY =
  'src/infrastructure/database/repositories/drizzle-workout-session-repository.ts';
const RUN_OCCURRENCE_WRITES =
  'src/infrastructure/database/repositories/drizzle-run-occurrence-writes.ts';
const SESSION_WRITES =
  'src/infrastructure/database/repositories/workout-session-writes.ts';
const START_USE_CASE = 'src/application/use-cases/start-workout-session.ts';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
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
