import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageContainer } from '@/components/shared/PageContainer';
import { LogoutButton } from '@/features/auth/components/LogoutButton';
import { requireUser } from '@/features/auth/current-user';
import { getUserProfileUseCase } from '@/features/profile/services';
import { formatDashboardDate } from '@/features/dashboard/dashboard-labels';
import { buildDashboardView, type WeekSummary } from '@/features/dashboard/dashboard-view';
import { CurrentProgramCard } from '@/features/dashboard/components/CurrentProgramCard';
import { NextWorkoutCard } from '@/features/dashboard/components/NextWorkoutCard';
import { NextWorkoutUnavailableCard } from '@/features/dashboard/components/NextWorkoutUnavailableCard';
import { NoProgramCard } from '@/features/dashboard/components/NoProgramCard';
import { ProfileSummaryCard } from '@/features/dashboard/components/ProfileSummaryCard';
import { ProgramCompletedCard } from '@/features/dashboard/components/ProgramCompletedCard';
import { RecentTrainingCard } from '@/features/dashboard/components/RecentTrainingCard';
import { WeeklyProgressCard } from '@/features/dashboard/components/WeeklyProgressCard';

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

  const view = await buildDashboardView(user.id, profile);
  const now = new Date();

  const currentProgram = view.currentProgram;
  const currentWeek: WeekSummary | null =
    currentProgram === null
      ? null
      : view.weekSummaries.find((week) => week.status === 'in-progress') ??
        view.weekSummaries[view.weekSummaries.length - 1] ??
        null;

  return (
    <PageContainer>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-wide text-accent-foreground md:text-[13px]">
            {formatDashboardDate(now)}
          </p>
          <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
            Your training
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/profile" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Edit profile
          </Link>
          {/* Not in the locked design; kept because this is the app's only
              in-session sign-out entry — removing it would delete working
              behavior. Rendered as a quiet text link. */}
          <LogoutButton className="text-sm font-medium text-ink-3 underline-offset-4 hover:text-foreground hover:underline" />
        </div>
      </header>

      {currentProgram === null ? (
        <div className="mt-6 md:mt-8">
          <NoProgramCard />
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-5 md:mt-8 md:flex-row md:items-start md:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-5 md:gap-6">
            {currentProgram.nextWorkoutPreview.status === 'available' ? (
              <NextWorkoutCard
                view={currentProgram.nextWorkoutPreview.workout}
                programName={currentProgram.program.name}
              />
            ) : currentProgram.nextWorkoutPreview.status === 'unavailable' ? (
              <NextWorkoutUnavailableCard />
            ) : (
              <ProgramCompletedCard
                programName={currentProgram.program.name}
                programSlug={currentProgram.program.slug}
                completedWorkouts={currentProgram.enrollment.progress.completedWorkouts}
                totalWorkouts={currentProgram.enrollment.progress.totalWorkouts}
              />
            )}
            <WeeklyProgressCard
              programName={currentProgram.program.name}
              currentWeek={currentWeek}
            />
            <RecentTrainingCard recentTraining={view.recentTraining} />
          </div>
          <aside className="flex w-full flex-col gap-6 md:w-[360px] md:shrink-0">
            <CurrentProgramCard view={currentProgram} />
            <ProfileSummaryCard profile={view.profile} now={now} className="hidden md:flex" />
          </aside>
        </div>
      )}
    </PageContainer>
  );
}
