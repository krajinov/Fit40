import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';

/**
 * Title area of one upcoming row: the performed exercise as the primary
 * name, with the same subtle "Originally: …" context used elsewhere when the
 * occurrence is substituted (the view mapper already resolved the authored
 * name; null renders no line).
 */
export function UpcomingExerciseTitle({
  exercise,
}: {
  readonly exercise: SessionExerciseCardView;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-ink-2 md:text-base">
        {exercise.name}
      </span>
      {exercise.originallyName !== null && (
        <span className="block truncate text-[11px] text-ink-3 md:text-xs">
          Originally: {exercise.originallyName}
        </span>
      )}
    </span>
  );
}
