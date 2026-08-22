import { describe, expect, it } from 'vitest';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function makeProgram() {
  const w1r = createWorkout({ id: 'wo-1', name: 'W1', slug: 'w1', description: 'A test workout', estimatedDurationMinutes: 30, exercises: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!w1r.ok) throw Error();
  const sw1 = swid('sched-1');
  const pr = createTrainingProgram({
    id: 'p1', name: 'P1', slug: 'prog-1', description: 'A test program', difficulty: Difficulty.Beginner, goal: ProgramGoal.Strength,
    durationWeeks: 1, workoutsPerWeek: 1, workouts: [w1r.data],
    weeks: [{ weekNumber: 1, scheduledWorkouts: [{ id: sw1, workoutId: w1r.data.id, order: 1 }] }],
  });
  if (!pr.ok) throw Error();
  return pr.data;
}

describe('findScheduledWorkoutOccurrence', () => {
  it('finds scheduled occurrence and workout template', () => {
    const program = makeProgram();
    const result = findScheduledWorkoutOccurrence(program, 1, 1);
    expect(result).not.toBeNull();
    expect(result!.scheduled.order).toBe(1);
    expect(result!.workout.id).toBe('wo-1');
  });

  it('returns null for unknown week', () => {
    expect(findScheduledWorkoutOccurrence(makeProgram(), 99, 1)).toBeNull();
  });

  it('returns null for unknown workout order', () => {
    expect(findScheduledWorkoutOccurrence(makeProgram(), 1, 99)).toBeNull();
  });
});