/**
 * Authored program-week lifecycle (M17) — the APPLICATION-owned projection of
 * one week's semantic lifecycle.
 *
 * The rule that used to live in `src/features/programs/week-status.ts` (Codex
 * architecture review) decided business meaning — completed / settled /
 * in-progress / upcoming — from authored occurrence state, so it does not
 * belong to presentation. It is owned HERE, in the Application's DTO layer,
 * because its facts ARE the application read model: the enrollment DTO's
 * completed occurrence ids, the closure DTO's recorded-not-performed identities
 * and first open occurrence, and the program DTO's authored occurrences — all
 * serialized plain strings/numbers, exactly the vocabulary this layer speaks.
 *
 * Pure: no React, no dates, no I/O, no repository. Presentation renders the
 * returned value (label, badge style, icon) and decides nothing itself.
 *
 * Locked semantics (the behavioural contract, unchanged):
 * - an authored-empty week claims nothing → `upcoming`;
 * - every authored occurrence completed → `completed` (a record never counts);
 * - the week holding the run's first OPEN occurrence → `in-progress` (a recorded
 *   occurrence is settled, so it never makes its week current);
 * - every authored occurrence settled (completed OR recorded) → `settled`;
 * - otherwise → `upcoming`.
 */

/** The semantic lifecycle of one authored program week. */
export type ProgramWeekLifecycle = 'completed' | 'in-progress' | 'settled' | 'upcoming';

/** The authored coordinates of the run's first open occurrence. */
export interface ProgramWeekLifecycleCoordinates {
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/** One authored occurrence of the week being resolved. */
export interface ProgramWeekLifecycleOccurrence {
  /** Authored occurrence identity, as serialized on the application DTOs. */
  readonly scheduledWorkoutId: string;
  /** Authored order of the occurrence inside its week. */
  readonly workoutOrder: number;
}

/**
 * The authored facts one week's lifecycle is decided from. Every set is a set
 * of AUTHORED occurrence identities as serialized on the application DTOs; the
 * first open occurrence is authored truth resolved by the run-closure read.
 */
export interface ProgramWeekLifecycleFacts {
  /** The authored number of the week being resolved. */
  readonly weekNumber: number;
  /** The week's authored occurrences (program structure), with their order. */
  readonly occurrences: ReadonlyArray<ProgramWeekLifecycleOccurrence>;
  /** M14 completion truth: authored occurrence ids with a completed session. */
  readonly completedIds: ReadonlySet<string>;
  /** M17 settlement truth: authored occurrence ids recorded as not performed. */
  readonly notPerformedIds: ReadonlySet<string>;
  /** The run's first OPEN authored occurrence, or null when none is open. */
  readonly firstOpenOccurrence: ProgramWeekLifecycleCoordinates | null;
}

/**
 * Resolves one authored week's lifecycle (precedence documented in the module
 * header). A recorded occurrence is settled truth, so a week whose only
 * "open-looking" occurrence is recorded stays `settled` — never the run's
 * current week.
 */
export function resolveProgramWeekLifecycle(
  facts: ProgramWeekLifecycleFacts,
): ProgramWeekLifecycle {
  const { occurrences, completedIds, notPerformedIds } = facts;

  if (occurrences.length === 0) {
    return 'upcoming';
  }

  if (occurrences.every((occurrence) => completedIds.has(occurrence.scheduledWorkoutId))) {
    return 'completed';
  }

  const firstOpen = facts.firstOpenOccurrence;
  if (firstOpen !== null && firstOpen.weekNumber === facts.weekNumber) {
    // The first open occurrence is authored structure, so it belongs to exactly
    // one week; it is never a recorded occurrence (the open set excludes
    // recorded ids by construction), which this guard keeps explicit.
    const currentOccurrence = occurrences.find(
      (occurrence) => occurrence.workoutOrder === firstOpen.workoutOrder,
    );
    if (
      currentOccurrence !== undefined &&
      !notPerformedIds.has(currentOccurrence.scheduledWorkoutId)
    ) {
      return 'in-progress';
    }
  }

  const allSettled = occurrences.every(
    (occurrence) =>
      completedIds.has(occurrence.scheduledWorkoutId) ||
      notPerformedIds.has(occurrence.scheduledWorkoutId),
  );
  return allSettled ? 'settled' : 'upcoming';
}
