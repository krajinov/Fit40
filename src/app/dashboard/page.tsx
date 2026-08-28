import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { requireUser } from '@/features/auth/current-user';
import { getUserProfileUseCase } from '@/features/profile/services';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const user = await requireUser('/dashboard');

  // New users are steered to onboarding before the dashboard content. This is
  // the single profile-awareness point after login/registration, so the auth
  // redirect flow itself stays unchanged.
  const profile = await getUserProfileUseCase.execute(user.id);
  if (profile === null) {
    redirect('/onboarding');
  }

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          Edit profile
        </Link>
        <LogoutButton className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" />
      </div>
    </main>
  );
}
