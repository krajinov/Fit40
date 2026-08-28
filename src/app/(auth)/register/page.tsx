import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/features/auth/current-user';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { nextPathSchema } from '@/features/auth/schemas/auth-schemas';

export const metadata: Metadata = {
  title: 'Create account',
};

interface RegisterPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const user = await getCurrentUser();
  if (user !== null) {
    redirect(resolveNext(await searchParams));
  }

  const nextPath = resolveNext(await searchParams);

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start your Fit40 journey today.</p>
      </div>

      <RegisterForm nextPath={nextPath} />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <a href="/login" className="text-primary hover:underline">
          Sign in
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
