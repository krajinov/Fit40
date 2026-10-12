import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for `/progress`.
 *
 * Approximates the page geometry: the heading, then summary sections and
 * chart-height blocks. The blocks are empty surfaces — no fabricated values,
 * axis labels or metrics are rendered while the two composed reads resolve.
 */
export default function ProgressLoading() {
  return (
    <PageContainer>
      <RoutePlaceholder
        label="Loading progress"
        blocks={['h-9 w-56 max-w-full', 'h-5 w-80 max-w-full', 'h-32', 'h-72', 'h-72']}
      />
    </PageContainer>
  );
}
