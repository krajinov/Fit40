import type { PlannedWorkoutDto } from '@/application/dto/schedule';
import { MovePlannedWorkoutForm } from '@/features/schedule/components/MovePlannedWorkoutForm';
import { RecordNotPerformedForm } from '@/features/schedule/components/RecordNotPerformedForm';
import { UndoNotPerformedForm } from '@/features/schedule/components/UndoNotPerformedForm';

interface ScheduleSlotControlsProps {
  readonly programSlug: string;
  readonly item: PlannedWorkoutDto;
}

/**
 * Settlement affordances of one calendar slot (M17 Slice 11), keyed ONLY by
 * the DTO status the application already resolved — this component never
 * re-derives a status, never inspects sessions and never predicts an outcome:
 *
 * - `planned` / `past-due`  → the existing Move disclosure, plus `Didn't train this`
 * - `in-progress`           → `Didn't train this` with the honesty sentence (the
 *                             use case decides whether abandoning it is legal)
 * - `not-performed`         → `Undo` only: no Move, no Start
 * - `completed`             → nothing (a completed occurrence is not settled)
 */
export function ScheduleSlotControls({ programSlug, item }: ScheduleSlotControlsProps) {
  if (item.status === 'not-performed') {
    return (
      <UndoNotPerformedForm
        programSlug={programSlug}
        weekNumber={item.weekNumber}
        workoutOrder={item.workoutOrder}
      />
    );
  }

  if (item.status === 'in-progress') {
    return (
      <RecordNotPerformedForm
        programSlug={programSlug}
        weekNumber={item.weekNumber}
        workoutOrder={item.workoutOrder}
        inProgress
      />
    );
  }

  if (item.status === 'planned' || item.status === 'past-due') {
    return (
      <div className="flex flex-col gap-2">
        <MovePlannedWorkoutForm
          programSlug={programSlug}
          weekNumber={item.weekNumber}
          workoutOrder={item.workoutOrder}
          plannedDate={item.plannedDate}
          workoutName={item.workoutName}
        />
        <RecordNotPerformedForm
          programSlug={programSlug}
          weekNumber={item.weekNumber}
          workoutOrder={item.workoutOrder}
          inProgress={false}
        />
      </div>
    );
  }

  return null;
}
