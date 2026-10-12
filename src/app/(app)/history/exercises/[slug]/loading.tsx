import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for `/history/exercises/[slug]`.
 *
 * Approximates the page geometry: the breadcrumb + heading area, the trend
 * section card and the occurrence rows. Decorative only — no load values, trend
 * points or personal records are rendered while the view resolves.
 */
export default function ExerciseHistoryLoading() {
  return (
    <PageContainer>
      <RoutePlaceholder
        label="Loading exercise history"
        blocks={['h-5 w-40', 'h-9 w-64 max-w-full', 'h-72', 'h-40', 'h-28', 'h-28']}
      />
    </PageContainer>
  );
}
