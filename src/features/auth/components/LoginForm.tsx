'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { loginAction } from '@/features/auth/actions/login';
import { AuthActionError } from '@/features/auth/components/AuthActionError';
import type { AuthActionState } from '@/features/auth/types/auth-action-state';

const initialState: AuthActionState = { ok: true };

interface LoginFormProps {
  readonly nextPath?: string;
}

function SubmitButton({ children }: { readonly children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {pending ? 'Signing in…' : children}
    </button>
  );
}

export function LoginForm({ nextPath = '/dashboard' }: LoginFormProps) {
  async function submitAction(
    _prev: AuthActionState,
    formData: FormData,
  ): Promise<AuthActionState> {
    return loginAction(formData);
  }

  const [state, formAction] = useActionState(submitAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {!state.ok && <AuthActionError error={state.error} />}

      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}
