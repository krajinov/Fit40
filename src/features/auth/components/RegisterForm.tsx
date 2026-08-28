'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { registerAction } from '@/features/auth/actions/register';
import { AuthActionError } from '@/features/auth/components/AuthActionError';
import type { AuthActionState } from '@/features/auth/types/auth-action-state';

const initialState: AuthActionState = { ok: true };

interface RegisterFormProps {
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
      {pending ? 'Creating account…' : children}
    </button>
  );
}

export function RegisterForm({ nextPath = '/dashboard' }: RegisterFormProps) {
  async function submitAction(
    _prev: AuthActionState,
    formData: FormData,
  ): Promise<AuthActionState> {
    return registerAction(formData);
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
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {!state.ok && <AuthActionError error={state.error} />}

      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}
