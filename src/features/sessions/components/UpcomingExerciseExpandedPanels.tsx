import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { SetLoggerForm } from '@/features/sessions/components/SetLoggerForm';
import { SessionExerciseSwapPanel } from '@/features/sessions/components/SessionExerciseSwapPanel';
import { SessionExerciseAdjustPanel } from '@/features/sessions/components/SessionExerciseAdjustPanel';
import type { SetLoggerDraft } from '@/features/sessions/set-logger-draft';

interface UpcomingExerciseExpandedPanelsProps {
  readonly exercise: SessionExerciseCardView;
  readonly log: WorkoutSessionExerciseDto;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /** Controlled logger draft owned by the occurrence boundary (PR #13 P2). */
  readonly draft?: SetLoggerDraft;
  readonly onDraftChange?: (draft: SetLoggerDraft) => void;
}

/**
 * Everything an upcoming row's expand reveals: the shared set logger (the
 * same island the full card uses), then the substitution affordance and the
 * skip/move affordance — untouched rows are exactly the occurrences the
 * domain lets the user swap or skip, so both sit inside the same expand.
 *
 * Every control consumes the pure view-mapper state verbatim; no substitution
 * or movement rule lives here. The logger draft is passed through from the
 * occurrence boundary (PR #13 P2) so it survives a representation change.
 */
export function UpcomingExerciseExpandedPanels({
  exercise,
  log,
  sessionId,
  expectedSessionVersion,
  programSlug,
  weekNumber,
  workoutOrder,
  draft,
  onDraftChange,
}: UpcomingExerciseExpandedPanelsProps) {
  const logger = exercise.logger;
  if (logger === null) {
    return null;
  }

  const showsSwapPanel =
    exercise.substitution.state === 'replace' ||
    exercise.substitution.state === 'restore-available' ||
    exercise.substitution.state === 'no-candidates';

  return (
    <div className="pb-3 pt-1">
      <SetLoggerForm
        key={`${exercise.renderKey}-${exercise.setRows.length}-${logger.prefillWeightKg ?? logger.prefillSeconds ?? 'none'}`}
        sessionId={sessionId}
        exerciseOrder={log.order}
        expectedSessionVersion={expectedSessionVersion}
        prescription={log.prescription}
        programSlug={programSlug}
        weekNumber={weekNumber}
        workoutOrder={workoutOrder}
        prefillWeightKg={logger.prefillWeightKg}
        prefillSeconds={logger.prefillSeconds}
        callout={logger.callout}
        quietLabel={logger.quietLabel}
        hintLabel={logger.hintLabel}
        draft={draft}
        onDraftChange={onDraftChange}
      />
      {/* Untouched rows are the prime substitution moment: the swap
          affordance (pure view-mapper state) sits under the logger inside
          the same expand. */}
      {showsSwapPanel && (
        <div className="pt-3">
          <SessionExerciseSwapPanel
            sessionId={sessionId}
            exerciseOrder={log.order}
            expectedSessionVersion={expectedSessionVersion}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
            substitution={exercise.substitution}
          />
        </div>
      )}
      {/* …and the prime skip/move moment (M10): the adjustment affordance
          (pure view-mapper state) sits in the same expand — the same shared
          panel the main card uses, no separate movement rule for upcoming
          rows. */}
      {exercise.adjustment.state !== 'hidden' && (
        <SessionExerciseAdjustPanel
          sessionId={sessionId}
          exerciseOrder={log.order}
          expectedSessionVersion={expectedSessionVersion}
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={workoutOrder}
          adjustment={exercise.adjustment}
        />
      )}
    </div>
  );
}
