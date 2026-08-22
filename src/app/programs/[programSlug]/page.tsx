import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getProgramBySlugUseCase } from '@/features/programs/services';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';
import { programSlugSchema } from '@/features/programs/schemas/program-routes-schema';

interface ProgramDetailPageProps {
  readonly params: Promise<{ readonly programSlug: string }>;
}

const getProgram = cache(async (programSlug: string) => {
  return getProgramBySlugUseCase.execute(programSlug);
});

export async function generateMetadata({
  params,
}: ProgramDetailPageProps): Promise<Metadata> {
  const { programSlug } = await params;
  const result = await getProgram(programSlug);

  if (!result.ok) {
    return { title: 'Program not found' };
  }

  return { title: result.data.name };
}

export default async function ProgramDetailPage({
  params,
}: ProgramDetailPageProps) {
  const { programSlug } = await params;

  const slugResult = programSlugSchema.safeParse(programSlug);
  if (!slugResult.success) {
    notFound();
  }

  const result = await getProgram(programSlug);
  if (!result.ok) {
    notFound();
  }

  return (
    <main className="container mx-auto flex-1 px-4 py-8 sm:py-12">
      <ProgramDetail program={result.data} />
    </main>
  );
}