import { Check, ChevronDown } from 'lucide-react';

import { Badge } from '@/components/shared/Badge';
import { cn } from '@/lib/utils';
import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import type { SessionExerciseCardView } from '@/features/sessions/active-workout-views';
import { SetLoggerForm } from '@/features/sessions/components/SetLoggerForm';
import { LoggedSetRow } from '@/features/sessions/components/LoggedSetRow';

interface SessionExerciseCardProps {
  readonly card: SessionExerciseCardView;
  /** The log this card was built from (prescription + raw sets for editing). */
  readonly log: WorkoutSessionExerciseDto;
  readonly sessionId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  /**
   * Read-only rendering for completed sessions: plain set rows without the
   * edit/delete islands (the domain restricts mutations to in-progress
   * sessions — this is presentation only, not authorization).
   */
  readonly readOnly?: boolean;
}

/**
 * One exercise card of the Active Workout screen (locked design): order
 * circle, name, prescription · equipment, state badge, the logged set rows,
 * and the set logger — open on the active exercise, collapsed behind a
 * quiet "Log set" affordance everywhere else so extra or out-of-order sets
 * remain loggable without cluttering the design's single open logger.
 *
 * The card is composition only; every label arrived pre-formatted from the
 * view mapper, and the logger/prefill semantics live in
 * `active-workout-logger-views.ts`.
 */
export function SessionExerciseCard({
  card,
  log,
  sessionId,
  programSlug,
  weekNumber,
  workoutOrder,
  readOnly = false,
}: SessionExerciseCardProps) {
  const logger = card.logger;
  const isDone = card.kind === 'done';

  return (
    <article
      className={cn(
        'flex flex-col gap-2.5 rounded-card border bg-card p-4 md:gap-3.5 md:p-6',
        card.kind === 'active' ? 'border-primary border-[1.5px]' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2.5 md:gap-3.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-pill text-[13px] font-semibold md:size-[34px] md:text-sm',
            isDone || card.kind === 'active'
              ? 'bg-primary text-primary-foreground'
              : 'bg-surface-2 text-ink-3',
          )}
        >
          {isDone ? <Check className="size-3.5 md:size-4" /> : card.order}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ink md:text-[17px]">{card.name}</h2>
          <p className="text-xs text-ink-2 md:text-sm">
            {card.prescriptionLabel}
            {card.equipmentLabel !== null && ` · ${card.equipmentLabel}`}
          </p>
        </div>

        <Badge
          variant={card.badge.style}
          className={card.badge.mobileVisible ? undefined : 'hidden md:inline-flex'}
        >
          {card.badge.label}
        </Badge>
      </div>

      {card.setRows.length > 0 && (
        <ul className="flex flex-col gap-1.5 md:gap-2">
          {log.sets.map((set, index) =>
            readOnly ? (
              <li
                key={set.setNumber}
                className="flex items-center gap-3 rounded-[10px] bg-background px-3 py-2.5 md:gap-3.5 md:rounded-xl md:px-4 md:py-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-[18px] shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground md:size-[22px]"
                >
                  <Check className="size-[11px] md:size-[13px]" />
                </span>
                <span className="w-14 shrink-0 text-[13px] font-medium text-ink-3 md:text-sm">
                  Set {set.setNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink md:text-[15px]">
                  {card.setRows[index]?.valueLabel ?? ''}
                </span>
              </li>
            ) : (
              <LoggedSetRow
                key={set.setNumber}
                sessionId={sessionId}
                set={set}
                exerciseOrder={log.order}
                programSlug={programSlug}
                weekNumber={weekNumber}
                workoutOrder={workoutOrder}
                isReps={log.prescription.type === 'reps'}
                valueLabel={card.setRows[index]?.valueLabel ?? ''}
              />
            ),
          )}
        </ul>
      )}

      {logger !== null && card.setRows.length > 0 && (
        <div aria-hidden="true" className="h-px bg-border" />
      )}

      {logger !== null &&
        (card.kind === 'active' ? (
          <SetLoggerForm
            key={`${card.order}-${card.setRows.length}-${logger.prefillWeightKg ?? 'none'}`}
            sessionId={sessionId}
            exerciseOrder={log.order}
            prescription={log.prescription}
            programSlug={programSlug}
            weekNumber={weekNumber}
            workoutOrder={workoutOrder}
            prefillWeightKg={logger.prefillWeightKg}
            callout={logger.callout}
          />
        ) : (
          <details className="group/log -mx-1">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              Log set
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-ink-3 transition-transform group-open/log:rotate-180"
              />
            </summary>
            <div className="pt-3">
              <SetLoggerForm
                key={`${card.order}-${card.setRows.length}-${logger.prefillWeightKg ?? 'none'}`}
                sessionId={sessionId}
                exerciseOrder={log.order}
                prescription={log.prescription}
                programSlug={programSlug}
                weekNumber={weekNumber}
                workoutOrder={workoutOrder}
                prefillWeightKg={logger.prefillWeightKg}
                callout={logger.callout}
              />
            </div>
          </details>
        ))}
    </article>
  );
}
