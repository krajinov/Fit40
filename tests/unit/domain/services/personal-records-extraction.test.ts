/**
 * M12 candidate extraction: metric eligibility, performed-exercise
 * attribution, several performances of one exercise, and the completed-only
 * boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { RecordMetric } from '@/domain/services/personal-record-metrics';
import { extractRecordCandidates } from '@/domain/services/personal-records';
import { addSessionExercise } from '@/domain/services/session-exercise-composition';
import { substituteSessionExercise } from '@/domain/services/session-exercise-substitution';
import { moveSessionExercise } from '@/domain/services/session-exercise-reorder';
import {
  candidateLines,
  completedSession,
  eid,
  inProgressSession,
  reps,
  sid,
  uid,
  wid,
} from './personal-records.fixtures';

// ─── Metric eligibility ──────────────────────────────────────────────────────

describe('extractRecordCandidates — metric eligibility', () => {
  it('maps an externally loaded rep set to max-load', () => {
    const session = completedSession({
      id: 's-load',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 5, weightKg: 80 }] }],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/80@1.1']);
  });

  it('treats a logged 0 kg rep set as a real max-load performance', () => {
    const session = completedSession({
      id: 's-zero',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 12, weightKg: 0 }] }],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/0@1.1']);
  });

  it('maps an unloaded rep set to max-bodyweight-reps', () => {
    const session = completedSession({
      id: 's-bw',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 12, weightKg: null }] }],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-bodyweight-reps/12@1.1']);
  });

  it('never lets an externally loaded set compete in max-bodyweight-reps', () => {
    const session = completedSession({
      id: 's-bw-loaded',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 20, weightKg: 5 },
            { type: 'reps', reps: 12, weightKg: null },
          ],
        },
      ],
    });

    expect(candidateLines(session)).toEqual([
      'ex-a/max-load/5@1.1',
      'ex-a/max-bodyweight-reps/12@1.2',
    ]);
  });

  it('never lets an unloaded rep set compete in max-load', () => {
    const session = completedSession({
      id: 's-unloaded',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 30, weightKg: null }] }],
    });

    const candidates = candidateLines(session);
    expect(candidates).toHaveLength(1);
    expect(candidates).not.toContain('ex-a/max-load/30@1.1');
  });

  it('maps a duration set to max-duration in seconds', () => {
    const session = completedSession({
      id: 's-duration',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          prescription: 'duration',
          sets: [{ type: 'duration', durationSeconds: 62 }],
        },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-duration/62@1.1']);
  });

  it('ignores the load of a duration set and never creates a max-load record', () => {
    const session = completedSession({
      id: 's-carry',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-carry',
          prescription: 'duration',
          sets: [{ type: 'duration', durationSeconds: 40, weightKg: 24 }],
        },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-carry/max-duration/40@1.1']);
  });

  it('produces no candidate for an occurrence with zero logged sets', () => {
    const session = completedSession({
      id: 's-zero-set',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] },
        { authored: 'ex-b' },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/60@1.1']);
  });

  it('produces no candidate for a skipped occurrence', () => {
    const session = completedSession({
      id: 's-skipped',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] },
        { authored: 'ex-skipped', isSkipped: true },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/60@1.1']);
  });

  it('produces no candidate for a rehydrated persisted skip decision', () => {
    const created = createWorkoutSession({
      id: 's-skip-rehydrated',
      userId: uid('user-1'),
      enrollmentId: null,
      scheduledWorkoutId: sid('sw-s-skip-rehydrated'),
      workoutId: wid('w-s-skip-rehydrated'),
      startedAt: new Date('2025-01-01T09:00:00Z'),
      exerciseLogs: [
        { authoredExerciseId: eid('ex-a'), order: 1, prescription: reps(), restSeconds: 60 },
        {
          authoredExerciseId: eid('ex-skipped'),
          order: 2,
          prescription: reps(),
          restSeconds: 60,
          isSkipped: true,
        },
      ],
    });
    if (!created.ok) throw new Error(created.error.message);

    const logged = logSessionSet(created.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 8,
      weightKg: 60,
      rpe: null,
    });
    if (!logged.ok) throw new Error(logged.error.message);

    const completed = completeWorkoutSession(logged.data, new Date('2025-01-01T10:00:00Z'));
    if (!completed.ok) throw new Error(completed.error.message);

    expect(candidateLines(completed.data)).toEqual(['ex-a/max-load/60@1.1']);
  });

  it('carries the exact deterministic position of every logged set', () => {
    const session = completedSession({
      id: 's-position',
      startedAt: '2025-01-01T09:15:00Z',
      completedAt: '2025-01-01T10:30:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] },
        {
          authored: 'ex-b',
          sets: [
            { type: 'reps', reps: 5, weightKg: null },
            { type: 'reps', reps: 7, weightKg: null },
          ],
        },
      ],
    });

    const result = extractRecordCandidates(session);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.data).toEqual([
      {
        exerciseId: 'ex-a',
        metric: RecordMetric.MaxLoad,
        value: 60,
        position: {
          completedAt: new Date('2025-01-01T10:30:00Z'),
          startedAt: new Date('2025-01-01T09:15:00Z'),
          sessionId: 's-position',
          exerciseOrder: 1,
          setNumber: 1,
        },
      },
      {
        exerciseId: 'ex-b',
        metric: RecordMetric.MaxBodyweightReps,
        value: 5,
        position: {
          completedAt: new Date('2025-01-01T10:30:00Z'),
          startedAt: new Date('2025-01-01T09:15:00Z'),
          sessionId: 's-position',
          exerciseOrder: 2,
          setNumber: 1,
        },
      },
      {
        exerciseId: 'ex-b',
        metric: RecordMetric.MaxBodyweightReps,
        value: 7,
        position: {
          completedAt: new Date('2025-01-01T10:30:00Z'),
          startedAt: new Date('2025-01-01T09:15:00Z'),
          sessionId: 's-position',
          exerciseOrder: 2,
          setNumber: 2,
        },
      },
    ]);
  });
});

// ─── Attribution ─────────────────────────────────────────────────────────────

describe('extractRecordCandidates — performed-exercise attribution', () => {
  it('credits a template occurrence to its performed exercise', () => {
    const session = completedSession({
      id: 's-template',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] }],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/60@1.1']);
  });

  it('credits a substituted occurrence to the performed exercise, not the authored one', () => {
    const session = completedSession({
      id: 's-substituted',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-authored',
          performed: 'ex-performed',
          sets: [{ type: 'reps', reps: 8, weightKg: 60 }],
        },
      ],
    });

    const candidates = candidateLines(session);
    expect(candidates).toEqual(['ex-performed/max-load/60@1.1']);
    expect(candidates).not.toContain('ex-authored/max-load/60@1.1');
  });

  it('credits a user-added occurrence to its exercise', () => {
    const session = completedSession({
      id: 's-user-added',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-goblet',
          source: OccurrenceSource.UserAdded,
          sets: [{ type: 'reps', reps: 15, weightKg: null }],
        },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-goblet/max-bodyweight-reps/15@1.1']);
  });

  it('credits a substituted user-added occurrence to the performed exercise', () => {
    const session = completedSession({
      id: 's-added-substituted',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-picked',
          performed: 'ex-swapped-in',
          source: OccurrenceSource.UserAdded,
          prescription: 'duration',
          sets: [{ type: 'duration', durationSeconds: 45 }],
        },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-swapped-in/max-duration/45@1.1']);
  });

  it('keeps attribution intact through the real substitution and user-add mutations', () => {
    const base = inProgressSession({
      id: 's-mutations',
      startedAt: '2025-01-01T09:00:00Z',
      logs: [{ authored: 'ex-authored' }],
    });

    const substituted = substituteSessionExercise(base, {
      exerciseOrder: 1,
      replacementExerciseId: eid('ex-stand-in'),
    });
    if (!substituted.ok) throw new Error(substituted.error.message);

    const added = addSessionExercise(substituted.data, {
      exerciseId: eid('ex-added'),
      prescription: reps(),
      restSeconds: 0,
    });
    if (!added.ok) throw new Error(added.error.message);

    const loggedFirst = logSessionSet(added.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 8,
      weightKg: 70,
      rpe: null,
    });
    if (!loggedFirst.ok) throw new Error(loggedFirst.error.message);

    const loggedSecond = logSessionSet(loggedFirst.data, {
      exerciseOrder: 2,
      type: 'reps',
      reps: 18,
      weightKg: null,
      rpe: null,
    });
    if (!loggedSecond.ok) throw new Error(loggedSecond.error.message);

    const completed = completeWorkoutSession(loggedSecond.data, new Date('2025-01-01T10:00:00Z'));
    if (!completed.ok) throw new Error(completed.error.message);

    expect(candidateLines(completed.data)).toEqual([
      'ex-stand-in/max-load/70@1.1',
      'ex-added/max-bodyweight-reps/18@2.1',
    ]);
  });
});

// ─── Multiple performances and duplicate occurrences ─────────────────────────

describe('extractRecordCandidates — multiple performances', () => {
  it('extracts one candidate per logged set, in set-number order', () => {
    const session = completedSession({
      id: 's-multi-set',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 8, weightKg: 60 },
            { type: 'reps', reps: 8, weightKg: 65 },
            { type: 'reps', reps: 8, weightKg: 55 },
          ],
        },
      ],
    });

    expect(candidateLines(session)).toEqual([
      'ex-a/max-load/60@1.1',
      'ex-a/max-load/65@1.2',
      'ex-a/max-load/55@1.3',
    ]);
  });

  it('keeps duplicate occurrences of one exercise distinguishable', () => {
    const session = completedSession({
      id: 's-duplicate',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
      ],
    });

    expect(candidateLines(session)).toEqual(['ex-a/max-load/80@1.1', 'ex-a/max-load/80@2.1']);
  });

  it('reads candidates without mutating the session', () => {
    const session = completedSession({
      id: 's-pure',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] }],
    });
    const before: WorkoutSession = structuredClone(session);

    extractRecordCandidates(session);

    expect(session).toEqual(before);
  });
});

// ─── Completed-only boundary ─────────────────────────────────────────────────

describe('personal records — completed-only boundary', () => {
  it('rejects extraction for an in-progress session', () => {
    const session = inProgressSession({
      id: 's-in-progress',
      startedAt: '2025-01-01T09:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] }],
    });

    const result = extractRecordCandidates(session);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the in-progress session to be rejected');
    expect(result.error.code).toBe('SESSION_NOT_COMPLETED');
  });
});

// ─── In-progress reorder × record positions (M10 × M12) ─────────────────────

describe('extractRecordCandidates — post-reorder positions', () => {
  it('follows the persisted exercise order after an in-progress reorder', () => {
    const base = inProgressSession({
      id: 's-reorder',
      startedAt: '2025-01-01T09:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 5, weightKg: 100 }] },
        { authored: 'ex-b', sets: [{ type: 'reps', reps: 5, weightKg: 80 }] },
      ],
    });

    const moved = moveSessionExercise(base, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw new Error(moved.error.message);

    const completed = completeWorkoutSession(moved.data, new Date('2025-01-01T10:00:00Z'));
    if (!completed.ok) throw new Error(completed.error.message);

    // The whole occurrence moved with its logged sets, so ex-b's set now
    // lives at order 1 and ex-a's set at order 2 — each still attributed to
    // its own performed exercise, at its new (exerciseOrder, setNumber).
    expect(candidateLines(completed.data)).toEqual([
      'ex-b/max-load/80@1.1',
      'ex-a/max-load/100@2.1',
    ]);
  });
});

// ─── Substituted occurrence that ends up skipped ────────────────────────────

describe('extractRecordCandidates — substituted then skipped', () => {
  it('extracts nothing from a substituted occurrence the user then skipped', () => {
    const session = completedSession({
      id: 's-skip-sub',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', performed: 'ex-b', isSkipped: true },
        { authored: 'ex-c', sets: [{ type: 'reps', reps: 5, weightKg: 70 }] },
      ],
    });

    // Neither the authored (ex-a) nor the performed (ex-b) exercise receives
    // a candidate from the skipped occurrence, while the untouched
    // occurrence at order 2 still extracts normally.
    expect(candidateLines(session)).toEqual(['ex-c/max-load/70@2.1']);
  });
});
