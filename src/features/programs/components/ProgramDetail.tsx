import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { NextWorkoutView } from '@/features/sessions/next-workout-view';
import { JoinProgramButton } from '@/features/enrollment/components/JoinProgramButton';
import { EnrolledProgramPanel } from '@/features/enrollment/components/EnrolledProgramPanel';
import { AnonymousVisitorCard } from '@/features/enrollment/components/AnonymousVisitorCard';
import { ProgramDetailHeader } from '@/features/programs/components/ProgramDetailHeader';
import { ProgramWeekSection } from '@/features/programs/components/ProgramWeekSection';
import type { ProgramWeekStatus } from '@/features/programs/components/ProgramWeekSection';

interface ProgramDetailProps {
  readonly program: ProgramDetailDto;
  /**
   * The authenticated user's enrollment view of this program, or null when
   * browsing anonymously (no enrollment controls or progress markers then).
   */
  readonly enrollment: ProgramEnrollmentViewDto | null;
  /**
   * Presentation view of the enrollment's next workout (shared with the
   * dashboard), or null when anonymous / not enrolled / fully completed.
   */
  readonly nextWorkout: NextWorkoutView | null;
}

/**
 * Derives a week's status from the enrollment: weeks before the next
 * incomplete workout are completed, its own week is in progress, later ones
 * upcoming. A null next workout (everything complete) marks all weeks
 * completed. Anonymous or not-enrolled visitors see every week upcoming.
 */
function weekStatus(
  weekNumber: number,
  enrollment: ProgramEnrollmentViewDto | null,
): ProgramWeekStatus {
  if (enrollment === null || enrollment.status !== 'enrolled') {
    return 'upcoming';
  }

  const next = enrollment.nextWorkout;
  if (next === null) {
    return 'completed';
  }
  if (weekNumber < next.weekNumber) {
    return 'completed';
  }
  if (weekNumber === next.weekNumber) {
    return 'in-progress';
  }
  return 'upcoming';
}

/**
 * Program detail screen (locked design): header, the visitor-specific
 * enrollment area, and the weekly schedule. Composition only — all data
 * arrives as DTOs/props from the page's use cases.
 */
export function ProgramDetail({
  program,
  enrollment,
  nextWorkout,
}: ProgramDetailProps) {
  const completedIds =
    enrollment !== null && enrollment.status === 'enrolled'
      ? new Set<string>(enrollment.completedScheduledWorkoutIds)
      : new Set<string>();
  const upNextKey =
    enrollment !== null &&
    enrollment.status === 'enrolled' &&
    enrollment.nextWorkout !== null
      ? `${enrollment.nextWorkout.weekNumber}-${enrollment.nextWorkout.workoutOrder}`
      : null;

  const metaLabel =
    nextWorkout === null
      ? ''
      : `${nextWorkout.exerciseCount} ${nextWorkout.exerciseCount === 1 ? 'exercise' : 'exercises'} · about ${nextWorkout.estimatedMinutes} minutes`;

  return (
    <div className="flex flex-col gap-8">
      <ProgramDetailHeader program={program} />

      {enrollment === null ? (
        <AnonymousVisitorCard programPath={`/programs/${program.slug}`} />
      ) : enrollment.status === 'not-enrolled' ? (
        <section
          aria-label="Join this program"
          className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-8"
        >
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Join this program
            </h2>
            <p className="max-w-lg text-sm text-ink-2">
              Your progress, completed workouts and next workout are tracked from the
              moment you join.
            </p>
          </div>
          <JoinProgramButton
            programSlug={program.slug}
            className="w-full md:w-auto md:shrink-0"
          />
        </section>
      ) : (
        <EnrolledProgramPanel
          program={program}
          enrollment={enrollment}
          nextWorkout={
            nextWorkout === null
              ? null
              : {
                  weekNumber: nextWorkout.weekNumber,
                  workoutOrder: nextWorkout.workoutOrder,
                  workoutName: nextWorkout.workoutName,
                  metaLabel,
                  sessionState: nextWorkout.sessionState,
                }
          }
        />
      )}

      <div className="flex flex-col gap-4 md:gap-6">
        <h2 className="font-display text-[22px] font-bold tracking-tight text-foreground md:text-2xl">
          Weekly schedule
        </h2>

        {program.weeks.map((week) => (
          <ProgramWeekSection
            key={week.weekNumber}
            programSlug={program.slug}
            week={week}
            status={weekStatus(week.weekNumber, enrollment)}
            completedIds={completedIds}
            upNextKey={upNextKey}
          />
        ))}
      </div>
    </div>
  );
}

