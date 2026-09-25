import type { WeeklyActivityWeekView } from '@/features/dashboard/weekly-insights-view';

export interface WeeklyActivityStripProps {
  readonly weeks: ReadonlyArray<WeeklyActivityWeekView>;
}

/**
 * Eight UTC-week bars (oldest → newest). Zero-workout weeks keep a visible
 * floor so "no training" is represented rather than blank. Server-rendered,
 * no chart dependency.
 */
export function WeeklyActivityStrip({ weeks }: WeeklyActivityStripProps) {
  const maxWorkouts = Math.max(1, ...weeks.map((w) => w.completedWorkouts));
  return (
    <ul className="flex items-end gap-1.5" aria-label="Weekly training activity">
      {weeks.map((week) => {
        const heightPercent = Math.round(
          (week.completedWorkouts / maxWorkouts) * 100,
        );
        return (
          <li key={week.weekStart} className="flex-1">
            <div
              className={`w-full rounded-t-[3px] ${
                week.isCurrentWeek ? 'bg-accent-strong' : 'bg-accent-tint'
              }`}
              style={{
                height: `${Math.max(heightPercent, week.completedWorkouts > 0 ? 8 : 3)}px`,
              }}
              aria-hidden="true"
            />
            <span className="sr-only">{week.accessibleLabel}</span>
          </li>
        );
      })}
    </ul>
  );
}
