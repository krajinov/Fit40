'use client';

import { Menu } from '@base-ui/react/menu';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { logoutAction } from '@/features/auth/actions/logout';

/**
 * Global account menu (application shell): profile navigation plus the
 * app-wide sign-out, reachable from every screen at both breakpoints.
 *
 * Lives in the auth feature — not `components/shared/` — so the shared shell
 * keeps zero feature imports: `(app)/layout.tsx` composes this into the
 * `account` slot the headers expose.
 *
 * Sign-out reuses the existing Server Action through a native form POST (the
 * menu item is the submit button): no new mutation path, no client-side
 * session state, and it still works without JavaScript — the same contract the
 * previous sign-out control had.
 *
 * The trigger keeps the locked-design pill: the desktop header shows the
 * initial + "Profile", the mobile header the avatar alone (labelled for
 * assistive tech).
 */
export interface AccountMenuProps {
  readonly userEmail: string;
  readonly variant: 'desktop' | 'mobile';
  /**
   * Renders the panel open on mount. Presentation tests use it — jsdom never
   * mounts the positioner otherwise — and app code never passes it.
   */
  readonly defaultOpen?: boolean;
}

function initialOf(email: string): string {
  return (email[0] ?? '').toUpperCase();
}

const ITEM_CLASS =
  'flex w-full cursor-pointer items-center rounded-control px-3 py-2.5 text-sm font-medium text-ink-2 outline-none transition-colors select-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-foreground';

export function AccountMenu({ userEmail, variant, defaultOpen }: AccountMenuProps) {
  const initial = initialOf(userEmail);

  return (
    <Menu.Root defaultOpen={defaultOpen ?? false}>
      {variant === 'desktop' ? (
        <Menu.Trigger className="flex cursor-pointer items-center gap-2.5 rounded-pill border border-border py-1.5 pr-3 pl-1.5 text-ink-2 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-pill bg-accent-tint text-[13px] font-semibold text-accent-strong"
          >
            {initial}
          </span>
          <span className="text-sm font-medium">Profile</span>
        </Menu.Trigger>
      ) : (
        <Menu.Trigger
          aria-label="Account"
          className="grid size-8 cursor-pointer place-items-center rounded-pill border border-accent-tint-border bg-accent-tint text-sm font-semibold text-accent-strong outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
        >
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