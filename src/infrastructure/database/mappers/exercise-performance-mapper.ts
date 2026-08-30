import type { LatestCompletedExercisePerformance } from '@/application/ports/workout-session-repository';
import type { SetLog } from '@/domain/entities/workout-session';

import { prescriptionFromColumns } from './prescription-mapper';
import { mapSet, parseExerciseId, parseWorkoutSessionId, type SetLogRow } from './session-mapper';

/**
 * Row shape produced by the latest-completed-performance DISTINCT ON query.
 */
export interface LatestPerformanceRow {
  readonly exerciseId: string;
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly completedAt: Date | null;
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
 * Maps the winning exercise-log rows to `LatestCompletedExercisePerformance`
 * projections, attaching their set logs.
 *
 * `setRows` may contain set logs of other exercises in the same sessions;
 * only rows matching a winning (session, exercise order) pair are used.
 * Throws on corrupt rows (unreachable through normal writes — the query
 * filters and the DB CHECK constraints enforce the shape).
 */
export function mapLatestCompletedExercisePerformances(
  performanceRows: ReadonlyArray<LatestPerformanceRow>,
  setRows: ReadonlyArray<SetLogRow>,
): ReadonlyArray<LatestCompletedExercisePerformance> {
  const setsByLog = new Map<string, SetLog[]>();
  for (const row of setRows) {
    const context = `set_logs (session_id=${row.sessionId}, exercise_order=${row.exerciseOrder})`;
    const key = logKey(row.sessionId, row.exerciseOrder);
    const sets = setsByLog.get(key) ?? [];
    sets.push(mapSet(row, context));
    setsByLog.set(key, sets);
  }

  return performanceRows.map((row) => {
    const context = `latest exercise performance (session_id=${row.sessionId}, exercise_order=${row.exerciseOrder})`;
    if (row.completedAt === null) {
      throw new Error(`Corrupt data in ${context}: completed_at is null`);
    }
    const sets = setsByLog.get(logKey(row.sessionId, row.exerciseOrder)) ?? [];
    return {
      exerciseId: parseExerciseId(row.exerciseId, context),
      sessionId: parseWorkoutSessionId(row.sessionId, context),
      exerciseOrder: row.exerciseOrder,
      completedAt: row.completedAt,
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