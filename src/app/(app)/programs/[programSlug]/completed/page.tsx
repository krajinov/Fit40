import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { PageContainer } from '@/components/shared/PageContainer';
import { requireUser } from '@/features/auth/current-user';
import { buildProgramCompletionView } from '@/features/enrollment/completion-view';
import { ProgramCompletionSummary } from '@/features/enrollment/components/ProgramCompletionSummary';
import { getProgramCompletionSummaryUseCase } from '@/features/enrollment/services';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';

export const metadata: Metadata = {
  title: 'Program completed',
};

interface ProgramCompletedPageProps {
  readonly params: Promise<{ readonly programSlug: string }>;
}

/**
 * The completed-program experience (M14 Slice 6).
 *
 * The completion state comes only from the application read — never from
 * query params or client state. Invalid or unknown slugs are 404s (the same
 * route semantics as program detail); an unauthenticated visitor is sent to
 * login with a `?next=` deep link back here; a run that is not enrolled or
 * not complete redirects to the program detail, which owns both states.
 * Unexpected failures throw to the error boundary. After a successful
 * restart this route naturally redirects, because the fresh enrollment is
 * incomplete.
 */
export default async function ProgramCompletedPage({ params }: ProgramCompletedPageProps) {
  const { programSlug } = await params;

  const slugResult = programSlugSchema.safeParse(programSlug);
  if (!slugResult.success) {
    notFound();
  }

  const user = await requireUser(`/programs/${programSlug}/completed`);

  const result = await getProgramCompletionSummaryUseCase.execute({
    userId: user.id,
    programSlug,
  });
  if (!result.ok) {
    if (result.error.code === 'PROGRAM_NOT_FOUND') {
      notFound();
    }
    // Unreachable in practice (trusted session user id + validated slug) —
    // treat as the unexpected failure it would be.
    throw new Error(
      `Failed to resolve program completion for "${programSlug}": ${result.error.message}`,
    );
  }

  // Not enrolled (null) or still running: the program detail page owns both.
  if (result.data === null || result.data.status === 'incomplete') {
    redirect(`/programs/${programSlug}`);
  }

  return (
    <PageContainer className="pt-10">
      <ProgramCompletionSummary view={buildProgramCompletionView(result.data)} />
    </PageContainer>
  );
}