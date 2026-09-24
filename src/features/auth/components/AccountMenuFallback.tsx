import Link from 'next/link';

import { logoutAction } from '@/features/auth/actions/logout';

/**
 * The native account controls shown until the interactive menu can take over
 * (PR #16 review).
 *
 * `AccountMenu` renders this for the server HTML and the hydration pass, then
 * replaces it once the client has really taken the page over, so profile
 * navigation and sign-out stay reachable whenever the Base UI menu is not yet
 * interactive — scripting unavailable, the bundle still loading, or a bundle
 * or hydration that never completes.
 *
 * Layout stability (PR #16 review, P2 #1): the visible pill/avatar reuses the
 * interactive trigger's own classes (`ACCOUNT_PILL_CLASS` / `ACCOUNT_AVATAR_CLASS`,
 * one source of truth for both states), so it occupies exactly the hydrated
 * trigger's box, and the sign-out form is taken out of flow — it hangs to the
 * left of the control instead of widening the right-aligned slot. Hydration
 * therefore cannot move the control, and both native actions stay directly
 * reachable in the meantime.
 *
 * No state, no effects and no client-only APIs: plain markup, rendered only
 * while the menu is unavailable.
 */

/** Which shell breakpoint renders the control (`md` switches between them). */
export type AccountVariant = 'desktop' | 'mobile';

export interface AccountMenuFallbackProps {
  readonly userEmail: string;
  readonly variant: AccountVariant;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

/**
 * The desktop account pill. Shared with the interactive trigger so the two
 * states can never drift into different footprints.
 */
export const ACCOUNT_PILL_CLASS =
  'flex cursor-pointer items-center gap-2.5 rounded-pill border border-border py-1.5 pr-3 pl-1.5 text-ink-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50';

/** The mobile avatar control, shared with the interactive trigger. */
export const ACCOUNT_AVATAR_CLASS =
  'grid size-8 cursor-pointer place-items-center rounded-pill border border-accent-tint-border bg-accent-tint text-sm font-semibold text-accent-strong outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * Out of flow on purpose: the secondary native action must not widen the slot
 * or shift the pill/avatar that hydration replaces.
 */
const SIGN_OUT_FORM_CLASS = 'absolute top-1/2 right-full mr-2 -translate-y-1/2';

/** `min-h-11` = 44px, the touch-target floor (docs/ui.md). */
const SIGN_OUT_CLASS =
  'min-h-11 rounded-sm px-1.5 py-2.5 text-sm font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

export function AccountMenuFallback({ userEmail, variant }: AccountMenuFallbackProps) {
  const initial = initialOf(userEmail);

  return (
    <div className="relative flex items-center">
      {variant === 'desktop' ? (
        <Link href="/profile" className={ACCOUNT_PILL_CLASS}>
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-pill bg-accent-tint text-[13px] font-semibold text-accent-strong"
          >
            {initial}
          </span>
          <span className="text-sm font-medium">Profile</span>
        </Link>
      ) : (
        <Link href="/profile" aria-label="Profile" className={ACCOUNT_AVATAR_CLASS}>
          <span aria-hidden="true">{initial}</span>
        </Link>
      )}

      <form action={logoutAction} className={SIGN_OUT_FORM_CLASS}>
        <button type="submit" className={SIGN_OUT_CLASS}>
          Sign out
        </button>
      </form>
    </div>
  );
}