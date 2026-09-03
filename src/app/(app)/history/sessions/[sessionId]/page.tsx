import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { notFound } from 'next/navigation';

import { PageContainer } from '@/components/shared/PageContainer';
import { CompletedSessionEntryList } from '@/features/history/components/CompletedSessionEntryList';
import { buildCompletedSessionView } from '@/features/history/completed-session-view';
import { completedSessionParamsSchema } from '@/features/history/schemas/completed-session-page-schema';
import { getCurrentUser, requireUser } from '@/features/auth/current-user';

interface CompletedSessionPageProps {
  readonly params: Promise<{ readonly sessionId: string }>;
}

export async function generateMetadata({
  params,
}: CompletedSessionPageProps): Promise<Metadata> {
  const parsed = completedSessionParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return { title: 'Completed workout' };
  }

  const user = await getCurrentUser();
  if (user === null) {
    return { title: 'Completed workout' };
  }

  const viewResult = await buildCompletedSessionView(user.id, parsed.data.sessionId);
  return { title: viewResult.ok ? viewResult.data.heading : 'Completed workout' };
}

export default async function CompletedSessionPage({ params }: CompletedSessionPageProps) {
  const { sessionId } = await params;

  const paramsResult = completedSessionParamsSchema.safeParse({ sessionId });
  if (!paramsResult.success) {
    notFound();
  }

  // Private page: auth is enforced here (the (app) layout deliberately
  // enforces nothing). The trusted session supplies the userId — never the
  // URL — so the id can only ever address the viewer's own history.
  const user = await requireUser(`/history/sessions/${paramsResult.data.sessionId}`);

  const viewResult = await buildCompletedSessionView(user.id, paramsResult.data.sessionId);
  // SESSION_NOT_FOUND covers a missing, foreign, or in-progress session —
  // one outcome, no existence leak. Unresolvable URL input is a 404.
  if (!viewResult.ok) {
    notFound();
  }
  const view = viewResult.data;

  return (
    <PageContainer>
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <li>
            <Link
              href="/history"
              className="rounded-control text-ink-3 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              History
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 shrink-0 text-ink-3" />
          </li>
          <li aria-current="page" className="font-medium text-foreground">
            {view.heading}
          </li>
        </ol>
      </nav>

      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-accent-foreground">
          {view.completedAtLabel}
          {view.elapsedLabel !== null ? ` · ${view.elapsedLabel}` : null}
        </p>
        <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground md:text-4xl">
          {view.heading}
        </h1>
        <p className="max-w-2xl text-sm text-ink-2 md:text-base">
          {view.contextLabel} · {view.metricsLineLabel}
        </p>
      </header>

      <CompletedSessionEntryList entries={view.entries} />
    </PageContainer>
  );
}
