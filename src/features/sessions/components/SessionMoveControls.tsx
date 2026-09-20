import { MOVE_DOWN_LABEL, MOVE_UP_LABEL } from '@/features/sessions/session-adjustment-views';

import { QUIET_CONTROL_CLASS } from './quiet-control-class';

interface SessionMoveControlsProps {
  /** Copied verbatim from the domain's eligibility projection. */
  readonly canMoveUp: boolean;
  /** Copied verbatim from the domain's eligibility projection. */
  readonly canMoveDown: boolean;
  /**
   * The `useActionState` form action of the move path, passed down from the
   * panel (the island holds no hooks — the client boundary stays the panel).
   */
  readonly formAction: (formData: FormData) => void;
  /**
   * The panel's COMBINED pending flag: every control of the panel is
   * disabled while any of its mutations is in flight, so a second click can
   * never submit a duplicate, the wrong form, or the wrong direction.
   */
  readonly pending: boolean;
  /** The move path's OWN pending flag: it drives only the busy label. */
  readonly busy: boolean;
}

/**
 * The adjacent-move island of one occurrence's adjustment panel (M10 Slice
 * 6): quiet "Move up"/"Move down" native forms posting to
 * `moveExerciseAction`. The direction arrives ONLY as the submitted form's
 * own hidden input — never from component state — so two rapid clicks on
 * opposite arrows can never cross wires: each form submits exactly its own
 * direction. A skipped or `blocked-logged-sets` occurrence still moves
 * (visibility comes from the domain's `canMoveUp`/`canMoveDown`, never
 * re-derived here).
 */
export function SessionMoveControls({
  canMoveUp,
  canMoveDown,
  formAction,
  pending,
  busy,
}: SessionMoveControlsProps) {
  if (!canMoveUp && !canMoveDown) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canMoveUp && (
        <form action={formAction}>
          <input type="hidden" name="direction" value="up" />
          <button type="submit" disabled={pending} className={QUIET_CONTROL_CLASS}>
            {busy ? 'Moving…' : MOVE_UP_LABEL}
          </button>
        </form>
      )}
      {canMoveDown && (
        <form action={formAction}>
          <input type="hidden" name="direction" value="down" />
          <button type="submit" disabled={pending} className={QUIET_CONTROL_CLASS}>
            {busy ? 'Moving…' : MOVE_DOWN_LABEL}
          </button>
        </form>
      )}
    </div>
  );
}
