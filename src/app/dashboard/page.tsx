import type { Metadata } from 'next';

import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { requireUser } from '@/features/auth/current-user';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const user = await requireUser('/dashboard');

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.
        </p>
      </div>

      <LogoutButton className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" />
    </main>
  );
}
