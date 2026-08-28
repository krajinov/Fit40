'use client';

import { logoutAction } from '@/features/auth/actions/logout';

interface LogoutButtonProps {
  readonly className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className={className}
      >
        Sign out
      </button>
    </form>
  );
}
