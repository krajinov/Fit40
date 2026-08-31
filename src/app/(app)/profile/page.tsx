import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireUser } from '@/features/auth/current-user';
import { ProfileForm } from '@/features/profile/components/ProfileForm';
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
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Your profile</h1>
          <p className="text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.email}</span>.
            Keep your training context up to date so programs and exercise suggestions
            stay relevant.
          </p>
        </div>

        <ProfileForm key={profile.updatedAt} profile={profile} />
      </div>
    </main>
  );
}
