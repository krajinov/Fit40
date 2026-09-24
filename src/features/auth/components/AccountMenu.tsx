'use client';

import { Menu } from '@base-ui/react/menu';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';
import { logoutAction } from '@/features/auth/actions/logout';
import {
  ACCOUNT_AVATAR_CLASS,
  ACCOUNT_PILL_CLASS,
  AccountMenuFallback,
  type AccountVariant,
} from '@/features/auth/components/AccountMenuFallback';

/**
 * Global account menu (application shell): profile navigation plus the
 * app-wide sign-out, reachable from every screen at both breakpoints.
 *
 * Lives in the auth feature — not `components/shared/` — so the shared shell
 * keeps zero feature imports: `(app)/layout.tsx` composes this into the
 * `account` slot the headers expose.
 *
 * Progressive enhancement (PR #16 review): the Base UI menu needs a hydrated
 * client — its trigger is inert until then — so this component renders the
 * native `AccountMenuFallback` instead for the server HTML and the first client
 * render, and swaps in the interactive menu only once hydration has actually
 * completed. A bundle that never loads, or a hydration that never finishes,
 * therefore leaves a reachable `/profile` link and sign-out form in place
 * rather than an inert button, while a hydrated page shows the interactive
 * menu and nothing else — the two are never visible at the same time, with no
 * `<noscript>` or "scripts are enabled" CSS assumption involved.
 *
 * Sign-out reuses the existing Server Action through a native form POST (the
 * menu item is the submit button): no new mutation path and no client-side
 * session state.
 *
 * The trigger keeps the locked-design pill: the desktop header shows the
 * initial + "Profile", the mobile header the avatar alone (labelled for
 * assistive tech). Its classes are `ACCOUNT_PILL_CLASS` / `ACCOUNT_AVATAR_CLASS`,
 * shared with the fallback above, so the control occupies the same box before
 * and after hydration and the right-aligned slot never shifts (PR #16 review,
 * P2 #1). The panel items keep their typography and padding and carry
 * `min-h-11` (44px) as the touch-target floor (P2 #2).
 */

export interface AccountMenuProps {
  readonly userEmail: string;
  readonly variant: AccountVariant;
  /**
   * Renders the panel open on mount. Presentation tests use it — jsdom never
   * mounts the positioner otherwise — and app code never passes it.
   */
  readonly defaultOpen?: boolean;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

/**
 * Hydration detection for the account control: `false` on the server and for
 * the hydration pass, `true` once the client owns the page. The store never
 * changes after that, so it needs no subscription.
 */
function subscribeToNothing(): () => void {
  return () => undefined;
}

function getHydratedSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

function useHasHydrated(): boolean {
  return useSyncExternalStore(subscribeToNothing, getHydratedSnapshot, getServerSnapshot);
}

/** `min-h-11` = 44px, the touch-target floor (docs/ui.md). */
const ITEM_CLASS =
  'flex min-h-11 w-full cursor-pointer items-center rounded-control px-3 py-2.5 text-sm font-medium text-ink-2 outline-none transition-colors select-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-foreground';

export function AccountMenu({ userEmail, variant, defaultOpen }: AccountMenuProps) {
  // The explicit hydration signal, owned here: the server snapshot (and the
  // hydration pass) is false, so the native fallback is what the HTML carries,
  // and the client snapshot is true, so React swaps in the interactive menu
  // once it has really taken over. Nothing to subscribe to — the value only
  // ever moves one way — which is why this is a snapshot store rather than
  // state set from an effect.
  const hydrated = useHasHydrated();

  if (!hydrated) {
    return <AccountMenuFallback userEmail={userEmail} variant={variant} />;
  }

  const initial = initialOf(userEmail);

  return (
    <Menu.Root defaultOpen={defaultOpen ?? false}>
      {variant === 'desktop' ? (
        <Menu.Trigger className={ACCOUNT_PILL_CLASS}>
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-pill bg-accent-tint text-[13px] font-semibold text-accent-strong"
          >
            {initial}
          </span>
          <span className="text-sm font-medium">Profile</span>
        </Menu.Trigger>
      ) : (
        <Menu.Trigger aria-label="Account" className={ACCOUNT_AVATAR_CLASS}>
          <span aria-hidden="true">{initial}</span>
        </Menu.Trigger>
      )}

      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-50 outline-none">
          <Menu.Popup className="flex min-w-[220px] flex-col rounded-callout border border-border bg-card p-1.5 shadow-lg outline-none">
            <Menu.LinkItem
              render={<Link href="/profile" />}
              className={cn(ITEM_CLASS, 'no-underline hover:no-underline')}
            >
              Profile
            </Menu.LinkItem>
            <Menu.Separator className="my-1.5 h-px bg-border" />
            <form action={logoutAction}>
              <Menu.Item nativeButton render={<button type="submit" />} className={ITEM_CLASS}>
                Sign out
              </Menu.Item>
            </form>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}