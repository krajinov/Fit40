import { CompleteSessionButton } from '@/features/sessions/components/CompleteSessionButton';

interface SessionFinishBarProps {
  readonly sessionId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Finish action placement (locked design): the desktop frame shows the
 * "Finish workout" primary button at the end of the content column; the
 * mobile frame replaces the shell's tab bar with a fixed surface bottom bar
 * carrying the same full-width action (the tab bar hides itself on session
 * routes; the shell's 76px clearance reserves this bar's space).
 */
export function SessionFinishBar({
  sessionId,
  programSlug,
  weekNumber,
  workoutOrder,
}: SessionFinishBarProps) {
  return (
    <>
      {/* Desktop: inline action at the end of the session column. */}
      <div className="hidden md:block">
        <CompleteSessionButton
          sessionId={sessionId}
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={workoutOrder}
        />
      </div>

      {/* Mobile: the locked frame's fixed bottom bar. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:hidden">
        <CompleteSessionButton
          sessionId={sessionId}
          programSlug={programSlug}
          weekNumber={weekNumber}
          workoutOrder={workoutOrder}
          fullWidth
        />
      </div>
    </>
  );
}
