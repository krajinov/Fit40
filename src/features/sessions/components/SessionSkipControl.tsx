import {
  SKIP_LABEL,
  UNSKIP_LABEL,
  type SessionAdjustmentState,
} from '@/features/sessions/session-adjustment-views';

import { QUIET_CONTROL_CLASS } from './quiet-control-class';

interface SessionSkipControlProps {
  /** `open` renders the Skip control; `skipped` renders Undo skip. */
  readonly state: Exclude<SessionAdjustmentState, 'hidden' | 'blocked-logged-sets'>;
  /**
   * The `useActionState` form action of the skip path, passed down from the
   * panel (the island holds no hooks — the client boundary stays the panel).
   */
  readonly formAction: (formData: FormData) => void;
  /**
   * The panel's COMBINED pending flag: every control of the panel is
   * disabled while any of its mutations is in flight, so a second click can
   * never submit a duplicate, the wrong form, or the wrong direction.
   */
  readonly pending: boolean;
  /** The skip path's OWN pending flag: it drives only the busy label. */
  readonly busy: boolean;
}

/**
 * The skip island of one occurrence's adjustment panel: a native `<form>`
 * posting to the skip or unskip Server Action (chosen by the panel's hook
 * wiring — the island never picks). No confirmation step: a skip is
 * reversible while the session is in progress, so the undo IS the
 * confirmation. Presentational only — no hooks, no rules; every fact arrives
 * pre-derived from the pure view mapper.
 */
export function SessionSkipControl({ state, formAction, pending, busy }: SessionSkipControlProps) {
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className={QUIET_CONTROL_CLASS}>
        {busy
          ? state === 'open'
            ? 'Skipping…'
            : 'Restoring…'
          : state === 'open'
            ? SKIP_LABEL
            : UNSKIP_LABEL}
      </button>
    </form>
  );
}
