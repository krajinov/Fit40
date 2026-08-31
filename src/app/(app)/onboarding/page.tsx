import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { PageContainer } from '@/components/shared/PageContainer';
import { OnboardingForm } from '@/features/profile/components/OnboardingForm';
import { ProfileSectionNav } from '@/features/profile/components/ProfileSectionNav';
import { requireUser } from '@/features/auth/current-user';
import { getUserProfileUseCase } from '@/features/profile/services';

export const metadata: Metadata = {
  title: 'Onboarding',
};

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');

  // Onboarding creates the profile; users who already have one edit it at
  // /profile instead. This keeps a single canonical flow and prevents
  // accidental double-create attempts from the UI.
  const profile = await getUserProfileUseCase.execute(user.id);
  if (profile !== null) {
    redirect('/profile');
  }

  return (
    <PageContainer className="pt-5 pb-6 md:pt-12 md:pb-20">
      <header className="space-y-1.5">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-[36px]">
          Set up your training profile
        </h1>
        <p className="text-sm text-ink-2 md:max-w-160 md:text-base">
          Fit40 is built for life after 40. A couple of minutes here helps match you with
          programs, exercises and alternatives that fit your goals, schedule and equipment.
        </p>
      </header>

      <div className="mt-5 flex flex-col gap-8 md:mt-10 md:flex-row md:items-start">
        <ProfileSectionNav className="hidden w-[260px] shrink-0 md:block" />
        <div className="min-w-0 flex-1">
          <OnboardingForm />
        </div>
      </div>
    </PageContainer>
  );
}
