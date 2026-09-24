import Link from 'next/link';

import { logoutAction } from '@/features/auth/actions/logout';

/**
 * The native account controls shown until the interactive menu can take over
 * (PR #16 review).
 *
 * `AccountMenu` renders this for the server HTML and the first client render,
 * then replaces it once hydration has completed. That keeps profile navigation
 * and sign-out reachable in every state where the Base UI menu is not yet
 * interactive — scripting unavailable, the bundle still loading, or a bundle
 * or hydration that never completes — because both controls are ordinary HTML:
 * a `/profile` link and a form posting to the existing `logoutAction`. They
 * need no JavaScript, add no mutation path, and mirror the visuals of the
 * menu control they stand in for.
 *
 * No state, no effects and no client-only APIs: it is plain markup, rendered
 * only while the menu is unavailable.
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

const PROFILE_PILL_CLASS =
  'flex items-center gap-2.5 rounded-pill border border-border py-1.5 pr-3 pl-1.5 text-ink-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50';

const PROFILE_AVATAR_CLASS =
  'grid size-8 place-items-center rounded-pill border border-accent-tint-border bg-accent-tint text-sm font-semibold text-accent-strong outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50';

const SIGN_OUT_CLASS =
  'rounded-sm px-1.5 py-2.5 text-sm font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

export function AccountMenuFallback({ userEmail, variant }: AccountMenuFallbackProps) {
  const initial = initialOf(userEmail);

  return (
    <div className="flex items-center gap-2">
      {variant === 'desktop' ? (
        <Link href="/profile" className={PROFILE_PILL_CLASS}>
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-pill bg-accent-tint text-[13px] font-semibold text-accent-strong"
          >
            {initial}
          </span>
          <span className="text-sm font-medium">Profile</span>
        </Link>
      ) : (
        <Link href="/profile" aria-label="Profile" className={PROFILE_AVATAR_CLASS}>
          <span aria-hidden="true">{initial}</span>
        </Link>
      )}

      <form action={logoutAction}>
        <button type="submit" className={SIGN_OUT_CLASS}>
          Sign out
        </button>
      </form>
    </div>
  );
}