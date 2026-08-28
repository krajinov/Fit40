import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/features/auth/components/LoginForm';
import { getCurrentUser } from '@/features/auth/current-user';
import { nextPathSchema } from '@/features/auth/schemas/auth-schemas';

export const metadata: Metadata = {
  title: 'Sign in',
};

interface LoginPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getCurrentUser();
  if (user !== null) {
    redirect(resolveNext(await searchParams));
  }

  const nextPath = resolveNext(await searchParams);

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue your training.</p>
      </div>

      <LoginForm nextPath={nextPath} />

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <a href="/register" className="text-primary hover:underline">
          Create one
        </a>
      </p>
    </div>
  );
}

function resolveNext(params: Readonly<Record<string, string | string[] | undefined>>): string {
  const raw = params['next'];
  const parsed = nextPathSchema.safeParse(typeof raw === 'string' ? raw : '/dashboard');
  return parsed.success ? parsed.data : '/dashboard';
}
