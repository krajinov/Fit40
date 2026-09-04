import type { CompletedExerciseOccurrence } from '@/application/ports/training-history-repository';
import type { SetLog } from '@/domain/entities/workout-session';

import { prescriptionFromColumns } from './prescription-mapper';
import { mapSet, parseWorkoutSessionId, type SetLogRow } from './session-mapper';

/**
 * Row shape produced by the per-exercise occurrence query: the exercise-log
 * snapshot columns plus the owning session's recency columns and the joined
 * display names.
 */
export interface ExerciseOccurrenceRow {
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly workoutName: string;
  readonly programName: string;
  readonly prescriptionType: string;
  readonly prescribedSets: number;
  readonly minReps: number | null;
  readonly maxReps: number | null;
  readonly durationSeconds: number | null;
}

function logKey(sessionId: string, exerciseOrder: number): string {
  return `${sessionId}#${exerciseOrder}`;
}

/**
 * Maps the bounded occurrence rows to `CompletedExerciseOccurrence`
 * projections, attaching their set logs.
 *
 * `setRows` may contain set logs of other exercises in the same sessions;
 * only rows matching a returned (session, exercise order) pair are used.
 * Set order within one occurrence is by set number; occurrence order is
 * preserved exactly as delivered by the query (the recency ladder), never
 * re-sorted here. Throws on corrupt rows (unreachable through normal
 * writes — the query filters and the DB CHECK constraints enforce the
 * shape).
 */
export function mapCompletedExerciseOccurrences(
  occurrenceRows: ReadonlyArray<ExerciseOccurrenceRow>,
  setRows: ReadonlyArray<SetLogRow>,
): ReadonlyArray<CompletedExerciseOccurrence> {
  const setsByLog = new Map<string, SetLog[]>();
  for (const row of setRows) {
    const context = `set_logs (session_id=${row.sessionId}, exercise_order=${row.exerciseOrder})`;
    const key = logKey(row.sessionId, row.exerciseOrder);
    const sets = setsByLog.get(key) ?? [];
    sets.push(mapSet(row, context));
    setsByLog.set(key, sets);
  }

  return occurrenceRows.map((row) => {
    const context = `exercise history occurrence (session_id=${row.sessionId}, exercise_order=${row.exerciseOrder})`;
    if (row.completedAt === null) {
      throw new Error(`Corrupt data in ${context}: completed_at is null`);
    }
    const sets = setsByLog.get(logKey(row.sessionId, row.exerciseOrder)) ?? [];
    return {
      sessionId: parseWorkoutSessionId(row.sessionId, context),
      exerciseOrder: row.exerciseOrder,
      completedAt: row.completedAt,
      programName: row.programName,
      workoutName: row.workoutName,
      prescription: prescriptionFromColumns(
        {
          prescriptionType: row.prescriptionType,
          sets: row.prescribedSets,
          minReps: row.minReps,
          maxReps: row.maxReps,
          durationSeconds: row.durationSeconds,
        },
        context,
      ),
      sets: [...sets].sort((a, b) => a.setNumber - b.setNumber),
    };
  });
}
