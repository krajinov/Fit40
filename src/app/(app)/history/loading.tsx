import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for `/history`.
 *
 * Approximates the page geometry: the heading, the totals summary card and the
 * session list rows. Decorative only — no totals, dates or workout names are
 * rendered while the paginated view resolves.
 */
export default function HistoryLoading() {
  return (
    <PageContainer>
      <RoutePlaceholder
        label="Loading training history"
        blocks={['h-9 w-64 max-w-full', 'h-5 w-72 max-w-full', 'h-36', 'h-24', 'h-24', 'h-24']}
      />
    </PageContainer>
  );
}
