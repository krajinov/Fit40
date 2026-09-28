/**
 * Run conclusion and restartability (M17).
 *
 * A run (one ProgramEnrollment) is *concluded* when execution truth already
 * accounts for every authored occurrence of its program: each authored
 * occurrence is settled by either a completed session (M14) or an explicit
 * not-performed record (M17). Conclusion is a derived read — there is no
 * persisted conclusion flag and no persisted conclusion date — and it is
 * deliberately NOT completion: a run can be concluded and incomplete at the
 * same time, which is exactly the case a user who did not train part of the
 * plan is in. `isProgramComplete` is untouched by this module and never
 * consults a not-performed fact.
 *
 * The denominator is the AUTHORED program occurrence set
 * (`listScheduledWorkoutsInOrder`), never the run's `planned_workouts` rows:
 * calendar rows are intent and are regenerated, while the authored program is
 * the run's definition. A recorded occurrence whose calendar row no longer
 * exists therefore still concludes its part of the run.
 *
 * Locked semantics:
 * - A zero-workout program is NEVER concluded, even though coverage over an
 *   empty set would be vacuously true (the `isProgramComplete` convention).
 * - An occurrence settled by neither fact keeps the run open. A live
 *   in-progress session is not a completion and not a not-performed record, so
 *   it keeps the run open.
 * - Planned dates are irrelevant and this module has no clock: a future
 *   occurrence, today's occurrence and a past-due occurrence are all simply
 *   open until the user settles them. Conclusion is never a date consequence.
 * - Duplicates inside one fact list count once (the `calculateProgramProgress`
 *   convention) and unknown ids are ignored in the counts while being reported
 *   in `unrecognizedIds`, so bad input is detectable and never silently
 *   absorbed.
 * - An authored occurrence present in BOTH lists is contradictory execution
 *   truth — M17 invariant I1 is "one settlement per occurrence" — and it FAILS
 *   LOUDLY. No precedence rule (`completed` outranking `not-performed`, or
 *   either fact being dropped) is invented, because both facts are
 *   authoritative and any winner rule would report a state matching neither.
 *   Valid writes cannot produce it (recording requires no completed session;
 *   completing a recorded occurrence is refused), so reaching it means
 *   corrupted data, a repository bug or a query regression. The check is scoped
 *   to AUTHORED occurrences: overlap on an id the program does not define stays
 *   a foreign-id report in `unrecognizedIds`.
 *
 * Pure: no I/O, no framework, no clock.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import { listScheduledWorkoutsInOrder } from '@/domain/services/program-progress';
import type { ScheduledWorkoutId } from '@/domain/types/ids';

/** The two execution facts a run's conclusion is derived from. */
export interface RunClosureFacts {
  /** Occurrences with a completed session (M14). */
  readonly completedIds: ReadonlyArray<ScheduledWorkoutId>;
  /** Occurrences explicitly recorded as not performed (M17). */
  readonly notPerformedIds: ReadonlyArray<ScheduledWorkoutId>;
}

/**
 * The run's closure state. Counts restate the facts; `isConcluded` is the one
 * derived verdict, and the open occurrences are returned in authored program
 * order so a caller never re-derives ordering.
 */
export interface RunClosure {
  readonly totalWorkouts: number;
  readonly completedWorkouts: number;
  readonly notPerformedWorkouts: number;
  /** Occurrences settled by either fact (counted once). */
  readonly settledWorkouts: number;
  readonly openWorkouts: number;
  /** The open authored occurrences, in authored program order. */
  readonly openInProgramOrder: ReadonlyArray<ScheduledWorkout>;
  /** Fact ids that do not belong to this program (bad input, reported loudly). */
  readonly unrecognizedIds: ReadonlyArray<ScheduledWorkoutId>;
  readonly isConcluded: boolean;
}

/**
 * Resolves conclusion, the settled/open counts and the open authored
 * occurrences in one pass over the authored schedule.
 */
export function resolveRunClosure(program: TrainingProgram, facts: RunClosureFacts): RunClosure {
  const authored = listScheduledWorkoutsInOrder(program);
  const authoredIds = new Set<ScheduledWorkoutId>(authored.map((occurrence) => occurrence.id));
  const completed = new Set<ScheduledWorkoutId>(facts.completedIds);
  const notPerformed = new Set<ScheduledWorkoutId>(facts.notPerformedIds);

  assertNoContradictorySettlements(authored, completed, notPerformed);

  const openInProgramOrder = authored.filter(
    (occurrence) => !completed.has(occurrence.id) && !notPerformed.has(occurrence.id),
  );

  const completedWorkouts = authored.filter((occurrence) => completed.has(occurrence.id)).length;
  const notPerformedWorkouts = authored.filter((occurrence) =>
    notPerformed.has(occurrence.id),
  ).length;
  const totalWorkouts = authored.length;
  const openWorkouts = openInProgramOrder.length;
  const settledWorkouts = totalWorkouts - openWorkouts;

  return {
    totalWorkouts,
    completedWorkouts,
    notPerformedWorkouts,
    settledWorkouts,
    openWorkouts,
    openInProgramOrder,
    unrecognizedIds: unrecognizedFactIds(facts, authoredIds),
    isConcluded: totalWorkouts > 0 && openWorkouts === 0,
  };
}

/**
 * Authoritative conclusion rule: the program defines at least one authored
 * occurrence AND every one of them is settled by a completed session or a
 * not-performed record.
 */
export function isRunConcluded(program: TrainingProgram, facts: RunClosureFacts): boolean {
  return resolveRunClosure(program, facts).isConcluded;
}

/** The two verdicts restartability is derived from. */
export interface RunRestartabilityFacts {
  /** `isProgramComplete(program, completedIds)` — M14, unchanged. */
  readonly programComplete: boolean;
  /** `isRunConcluded(program, facts)` — this module. */
  readonly runConcluded: boolean;
}

/**
 * Authoritative restartability rule: a run may start over when it is complete
 * OR concluded. A zero-workout run is neither, so it is not restartable; an
 * open run is not restartable, so "start over" can never discard outstanding
 * work. This is the pure rule only — no use case, port or persistence is
 * involved here.
 */
export function isRunRestartable(facts: RunRestartabilityFacts): boolean {
  return facts.programComplete || facts.runConcluded;
}

/** Unique fact ids outside the authored schedule, in first-seen order. */
function unrecognizedFactIds(
  facts: RunClosureFacts,
  authoredIds: ReadonlySet<ScheduledWorkoutId>,
): ReadonlyArray<ScheduledWorkoutId> {
  const unique = new Set<ScheduledWorkoutId>([...facts.completedIds, ...facts.notPerformedIds]);
  return [...unique].filter((id) => !authoredIds.has(id));
}

/**
 * Enforces M17 I1 (one settlement per occurrence) on the AUTHORED schedule: an
 * occurrence that is both completed and explicitly recorded as not performed is
 * contradictory authoritative execution truth.
 *
 * Throws rather than reconciling (the `follow-through-week.ts` /
 * `'… contract violated: …'` convention): both facts are authoritative, so any
 * precedence rule would invent a policy and report a run state matching neither
 * fact. The first contradiction in authored program order is reported, so the
 * failure is deterministic regardless of fact-list order.
 *
 * Scoped to authored occurrences on purpose: an id the program does not define
 * can never settle anything, so it keeps the established foreign-id contract
 * (`unrecognizedIds`) instead of becoming a settlement or an error.
 */
function assertNoContradictorySettlements(
  authored: ReadonlyArray<ScheduledWorkout>,
  completed: ReadonlySet<ScheduledWorkoutId>,
  notPerformed: ReadonlySet<ScheduledWorkoutId>,
): void {
  const contradictory = authored.find(
    (occurrence) => completed.has(occurrence.id) && notPerformed.has(occurrence.id),
  );

  if (contradictory !== undefined) {
    throw new Error(
      `Run closure contract violated: occurrence "${contradictory.id}" is both completed and recorded as not performed`,
    );
  }
}
