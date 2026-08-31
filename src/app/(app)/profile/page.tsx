import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageContainer } from '@/components/shared/PageContainer';
import { ProfileForm } from '@/features/profile/components/ProfileForm';
import { ProfileSectionNav } from '@/features/profile/components/ProfileSectionNav';
import { requireUser } from '@/features/auth/current-user';
import { getUserProfileUseCase } from '@/features/profile/services';

export const metadata: Metadata = {
  title: 'Profile',
};

export default async function ProfilePage() {
  const user = await requireUser('/profile');

  const profile = await getUserProfileUseCase.execute(user.id);
  if (profile === null) {
    redirect('/onboarding');
  }

  return (
    <PageContainer className="pt-5 pb-6 md:pt-12 md:pb-20">
      <header className="space-y-1.5">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-[36px]">
          Your profile
        </h1>
        <p className="text-sm text-ink-2 md:max-w-160 md:text-base">
          <span className="md:hidden">Programs and exercise suggestions adapt to this.</span>
          <span className="hidden md:inline">
            Keep your training context up to date — programs and exercise suggestions adapt to it.
          </span>
        </p>
        <p className="hidden text-sm text-ink-3 md:block">Signed in as {user.email}.</p>
      </header>

      <div className="mt-5 flex flex-col gap-8 md:mt-10 md:flex-row md:items-start">
        <ProfileSectionNav className="hidden w-[260px] shrink-0 md:block" />
        <div className="min-w-0 flex-1">
          <ProfileForm key={profile.updatedAt} profile={profile} />
        </div>
      </div>
    </PageContainer>
  );
}
