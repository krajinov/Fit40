import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireUser } from '@/features/auth/current-user';
import { OnboardingForm } from '@/features/profile/components/OnboardingForm';
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
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Set up your training profile
          </h1>
          <p className="text-muted-foreground">
            Fit40 is built for life after 40. A couple of minutes here helps match you
            with programs, exercises and alternatives that fit your goals, schedule and
            equipment.
          </p>
        </div>

        <OnboardingForm />
      </div>
    </main>
  );
}
