import { getExerciseHistoryPresenceUseCase } from '@/features/exercises/services';

export type ExerciseHistoryPresenceView =
  | { readonly status: 'present'; readonly personalHistoryHref: string }
  | { readonly status: 'absent' | 'unavailable'; readonly personalHistoryHref?: never };

/** Optional personalization; diagnostics remain on the server. */
export async function buildExerciseHistoryPresenceView(
  userId: string,
  slug: string,
): Promise<ExerciseHistoryPresenceView> {
  const result = await getExerciseHistoryPresenceUseCase.execute({ userId, slug });
  // The route has already resolved the public exercise. An expected validation
  // or lookup error here must not turn into a confirmed successful empty read.
  if (!result.ok) return { status: 'unavailable' };

  switch (result.data.status) {
    case 'present':
      return { status: 'present', personalHistoryHref: `/history/exercises/${slug}` };
    case 'absent':
      return { status: 'absent' };
    case 'unavailable':
      console.error(
        `Unexpected failure loading exercise history presence for user ${userId} (${slug})`,
        result.data.cause,
      );
      return { status: 'unavailable' };
  }
}
