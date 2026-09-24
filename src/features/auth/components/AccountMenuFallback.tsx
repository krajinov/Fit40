import Link from 'next/link';

import { logoutAction } from '@/features/auth/actions/logout';
import type { AccountVariant } from '@/features/auth/components/AccountMenu';

/**
 * No-JavaScript counterpart of the account menu (PR #16 review, P2 #2).
 *
 * `AccountMenu` is client-controlled, so without scripting its trigger is
 * inert and neither account action can be reached. The shell therefore renders
 * this server-side pair alongside it — a plain profile link and a native
 * `<form>` POST to the existing `logoutAction` — restoring the reachability
 * the previous header link and dashboard sign-out form provided.
 *
 * Progressive enhancement, not duplication: the wrapper is hidden by
 * `globals.css` (`.account-menu-fallback`) in every scripted browser, and is
 * revealed — while the inert menu trigger is hidden (`.account-menu-trigger`)
 * — by the `<noscript>` rule below, which browsers apply only when scripting
 * is unavailable. `dangerouslySetInnerHTML` is required for it: with scripting
 * enabled browsers parse `<noscript>` content as text, so React has to emit
 * the rule verbatim (string children would be escaped).
 *
 * A Server Component on purpose: no `'use client'`, no session state, no new
 * mutation path, and the markup exists before — and independently of —
 * hydration.
 */
export interface AccountMenuFallbackProps {
  readonly userEmail: string;
  readonly variant: AccountVariant;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

/**
 * Applied only where `<noscript>` content is parsed as markup, i.e. without
 * scripting: the fallback appears and the inert trigger disappears. Both rules
 * stay unlayered so they win over Tailwind's layered utilities.
 */
const NO_SCRIPT_STYLE =
  '<style>.account-menu-fallback{display:flex}.account-menu-trigger{display:none}</style>';

const PROFILE_PILL_CLASS =
  'flex items-center gap-2.5 rounded-pill border border-border py-1.5 pr-3 pl-1.5 text-ink-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50';

const PROFILE_AVATAR_CLASS =
  'grid size-8 place-items-center rounded-pill border border-accent-tint-border bg-accent-tint text-sm font-semibold text-accent-strong outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50';

const SIGN_OUT_CLASS =
  'rounded-sm px-1.5 py-2.5 text-sm font-medium text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50';

export function AccountMenuFallback({ userEmail, variant }: AccountMenuFallbackProps) {
  const initial = initialOf(userEmail);

  return (
    <div className="account-menu-fallback items-center gap-2">
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

      <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT_STYLE }} />
    </div>
  );
}