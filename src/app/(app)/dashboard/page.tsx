import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageContainer } from '@/components/shared/PageContainer';
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
    <PageContainer>
      <div className="mb-8 space-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-[36px]">
          Dashboard
        </h1>
        <p className="text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/profile" className={buttonVariants({ variant: 'secondary' })}>
          Edit profile
        </Link>
        <LogoutButton className={buttonVariants({ variant: 'ghost', size: 'sm' })} />
      </div>
    </PageContainer>
  );
}
