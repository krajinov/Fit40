import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageContainer } from '@/components/shared/PageContainer';
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
import { RecentPersonalBestsCard } from '@/features/dashboard/components/RecentPersonalBestsCard';
import { RecentTrainingCard } from '@/features/dashboard/components/RecentTrainingCard';
import { WeeklyInsightsCard } from '@/features/dashboard/components/WeeklyInsightsCard';
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

  // Single request clock: drives both the header date and the weekly
  // insights' UTC week windows (the presentation layer never calls
  // Date.now() itself — the domain receives a caller-supplied instant).
  const now = new Date();
  const view = await buildDashboardView(user.id, profile, now);

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
          {/* Sign-out moved to the global account menu in the shell header
              (every screen, both breakpoints) — the dashboard keeps only the
              profile shortcut it was designed with. */}
        </div>
      </header>

      {currentProgram === null ? (
        <>
          <div className="mt-6 md:mt-8">
            <NoProgramCard />
          </div>
          {/* Insights are user-global: they render with or without an
              enrollment, right after the no-program state. */}
          <div className="mt-5 md:mt-8">
            <WeeklyInsightsCard state={view.weeklyInsights} />
          </div>
          <div className="mt-5 md:mt-8">
            <RecentPersonalBestsCard state={view.weeklyInsights} />
          </div>
          {/* No program yet ≠ no history: users finishing ad-hoc or
              pre-program sessions still see their recent training (it is
              also the dashboard's mobile entry point to History). */}
          <div className="mt-5 md:mt-8">
            <RecentTrainingCard recentTraining={view.recentTraining} />
          </div>
        </>
      ) : (
        <div className="mt-5 flex flex-col gap-5 md:mt-8 md:flex-row md:items-start md:gap-6">
          {/* Mobile order (Up next → This week → Program week → Current
              program → Personal bests) comes from DOM order plus flex
              `order`; at md both wrappers restore as the main column and
              the aside, so neither card is rendered twice. */}
          <div className="contents md:flex md:min-w-0 md:flex-1 md:flex-col md:gap-6">
            <div className="order-1">
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
            </div>
            <div className="order-2">
              <WeeklyInsightsCard state={view.weeklyInsights} />
            </div>
            <WeeklyProgressCard
              className="order-3"
              programName={currentProgram.program.name}
              currentWeek={currentWeek}
            />
            <div className="order-5">
              <RecentPersonalBestsCard state={view.weeklyInsights} />
            </div>
            {/* Recent training stays visible on mobile: the tab bar has no
                History tab, so this card is the dashboard's entry point to
                /history on mobile (RecentTrainingCard's documented contract).
                It sorts after Personal bests at both breakpoints. */}
            <RecentTrainingCard
              recentTraining={view.recentTraining}
              className="order-6"
            />
          </div>
          <div className="contents md:flex md:w-[360px] md:shrink-0 md:flex-col md:gap-6">
            <div className="order-4">
              <CurrentProgramCard view={currentProgram} />
            </div>
            <ProfileSummaryCard
              profile={view.profile}
              now={now}
              className="order-7 hidden md:flex"
            />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
