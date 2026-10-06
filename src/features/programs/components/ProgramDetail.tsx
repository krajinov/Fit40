import type { EnrollmentFollowThroughDto } from '@/application/dto/follow-through';
import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { ScheduleReadState } from '@/application/dto/schedule';
import type { NextWorkoutPreviewState } from '@/features/sessions/next-workout-view';
import {
  resolveRunNextOccurrence,
} from '@/features/enrollment/next-occurrence';
import { JoinProgramButton } from '@/features/enrollment/components/JoinProgramButton';
import { EnrolledProgramPanel } from '@/features/enrollment/components/EnrolledProgramPanel';
import { AnonymousVisitorCard } from '@/features/enrollment/components/AnonymousVisitorCard';
import { ProgramDetailHeader } from '@/features/programs/components/ProgramDetailHeader';
import { ProgramWeekSection } from '@/features/programs/components/ProgramWeekSection';
import { resolveProgramWeekStatus } from '@/features/programs/week-status';
import { PlanFollowThroughSection } from '@/features/schedule/components/PlanFollowThroughSection';
import { ProgramScheduleSection } from '@/features/schedule/components/ProgramScheduleSection';

interface ProgramDetailProps {
  readonly program: ProgramDetailDto;
  /**
   * The authenticated user's enrollment view of this program, or null when
   * browsing anonymously (no enrollment controls or progress markers then).
   */
  readonly enrollment: ProgramEnrollmentViewDto | null;
  /**
   * Multi-valued next-workout state of the enrollment (shared with the
   * dashboard): available / unavailable / complete / concluded. Null when
   * anonymous or not enrolled — no enrollment controls or up-next area then.
   * The panel reads its own lifecycle from `runClosure`, so a `complete` state
   * for a concluded run still renders the factual run-closed callout.
   */
  readonly nextWorkoutPreview: NextWorkoutPreviewState | null;
  /**
   * The M15 schedule read for this run (Slice 6): non-null only when the page
   * resolved an enrolled, not-completed run. `unavailable` (failed read) and
   * `configured: false` stay distinct inside the state, and a completed run
   * arrives as null so the M14 completion surface remains the only lifecycle
   * state shown. Composition only — status/focus arrive derived.
   */
  readonly schedule: ScheduleReadState | null;
  /**
   * The M16 plan follow-through read for this run (Slice 5): non-null only when
   * the page resolved an enrolled, not-completed run and the read succeeded.
   * `configured: false` is passed through — the section renders nothing for it,
   * because configuring training days belongs to the M15 surface just above.
   * Composition only — every count arrives derived.
   */
  readonly followThrough: EnrollmentFollowThroughDto | null;
  /**
   * The M17 run-closure summary of this run (Slice 10): factual counts plus the
   * complete / concluded / open verdicts, or null when the read failed or the
   * visitor has no run. Composition only — the panel renders the three states
   * from it (M17 Slice 11) and never recomputes a verdict; the M14 completion
   * surface remains the only completion state.
   */
  readonly runClosure: RunClosureSummaryDto | null;
}

/**
 * Program detail screen (locked design): header, the visitor-specific
 * enrollment area, the M15 week calendar, the M16 plan follow-through, and the
 * authored weekly schedule. Composition only — all data arrives as DTOs/props
 * from the page's use cases.
 */
export function ProgramDetail({
  program,
  enrollment,
  nextWorkoutPreview,
  schedule,
  followThrough,
  runClosure,
}: ProgramDetailProps) {
  const enrolled = enrollment !== null && enrollment.status === 'enrolled';
  const completedIds = enrolled
    ? new Set<string>(enrollment.completedScheduledWorkoutIds)
    : new Set<string>();

  // The run's AUTHORITATIVE next occurrence (M17 Slice 11 correction): the
  // closure-resolved FIRST OPEN authored occurrence when the closure read
  // supplied it, else the M14 next workout. Selecting it here is composition,
  // never a recomputation of openness — `openInProgramOrder` is Domain truth.
  const nextOccurrence = enrolled
    ? resolveRunNextOccurrence(enrollment.nextWorkout, runClosure)
    : null;

  // Occurrences the run has already settled as recorded-not-performed,
  // addressed by the same route key the up-next preview uses.
  //
  // The AUTHORITATIVE source is the closure read's authored identity set
  // (`notPerformedInProgramOrder`): it is Application-resolved from the run's
  // own execution facts, so it survives an UNAVAILABLE M15 calendar read —
  // without it, recorded cards used to render as "Scheduled" and settled weeks
  // as "Upcoming" whenever the calendar degraded. Only when the closure read is
  // null (failed) does this fall back to the M15 read's recorded items and
  // rowless `unplacedNotPerformedWorkouts`. Settlement is never inferred from
  // counts and never from a missing session.
  const recordedKeys = new Set<string>();
  if (runClosure !== null) {
    for (const occurrence of runClosure.notPerformedInProgramOrder) {
      recordedKeys.add(`${occurrence.weekNumber}-${occurrence.workoutOrder}`);
    }
  } else if (schedule !== null && schedule.status === 'loaded') {
    for (const item of schedule.schedule.items) {
      if (item.status === 'not-performed') {
        recordedKeys.add(`${item.weekNumber}-${item.workoutOrder}`);
      }
    }
    for (const unplaced of schedule.schedule.unplacedNotPerformedWorkouts) {
      recordedKeys.add(`${unplaced.weekNumber}-${unplaced.workoutOrder}`);
    }
  }

  const upNextKey =
    nextOccurrence === null
      ? null
      : `${nextOccurrence.weekNumber}-${nextOccurrence.workoutOrder}`;

  const availableWorkout =
    nextWorkoutPreview !== null && nextWorkoutPreview.status === 'available'
      ? nextWorkoutPreview.workout
      : null;

  const metaLabel =
    availableWorkout === null
      ? ''
      : `${availableWorkout.exerciseCount} ${availableWorkout.exerciseCount === 1 ? 'exercise' : 'exercises'} · about ${availableWorkout.estimatedMinutes} minutes`;

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
          runClosure={runClosure}
          nextWorkout={
            nextWorkoutPreview === null
              ? null
              : nextWorkoutPreview.status === 'available'
                ? {
                    weekNumber: nextWorkoutPreview.workout.weekNumber,
                    workoutOrder: nextWorkoutPreview.workout.workoutOrder,
                    workoutName: nextWorkoutPreview.workout.workoutName,
                    metaLabel,
                    sessionState: nextWorkoutPreview.workout.sessionState,
                  }
                : nextWorkoutPreview.status === 'unavailable'
                  ? 'unavailable'
                  : null
          }
        />
      )}

      {/* M15 (Slice 6): the calendar view of this run, between the enrollment
          area and the authored weeks. Read-only and additive — a failed read
          degrades to null inside the section, and a completed run never passes
          a schedule at all, so the M14 surface above stays authoritative. */}
      {schedule !== null && <ProgramScheduleSection schedule={schedule} />}

      {/* M16 (Slice 5): how this run's calendar has held up, directly below the
          M15 week it describes and above the authored weeks. Additive and
          read-only: a failed read arrives as null (logged at the page), an
          unconfigured run renders nothing inside the section, and a completed
          run is never passed one — the M14 surface above stays authoritative. */}
      {followThrough !== null && <PlanFollowThroughSection followThrough={followThrough} />}

      <div className="flex flex-col gap-4 md:gap-6">
        <h2 className="font-display text-[22px] font-bold tracking-tight text-foreground md:text-2xl">
          Weekly schedule
        </h2>

        {program.weeks.map((week) => (
          <ProgramWeekSection
            key={week.weekNumber}
            programSlug={program.slug}
            week={week}
            status={resolveProgramWeekStatus({
              enrolled,
              weekNumber: week.weekNumber,
              occurrences: week.scheduledWorkouts.map((scheduled) => ({
                scheduledWorkoutId: scheduled.scheduledWorkoutId,
                key: `${week.weekNumber}-${scheduled.order}`,
              })),
              completedIds,
              recordedKeys,
              upNext: nextOccurrence,
            })}
            completedIds={completedIds}
            recordedKeys={recordedKeys}
            upNextKey={upNextKey}
          />
        ))}
      </div>
    </div>
  );
}

