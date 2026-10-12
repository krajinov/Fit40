import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for `/dashboard`.
 *
 * Approximates the page geometry: the date/heading header, then the summary
 * card stack (program + insights + recent). Decorative only — no dates,
 * metrics or workout names are rendered while the route awaits its
 * server-rendered content.
 */
export default function DashboardLoading() {
  return (
    <PageContainer>
      <RoutePlaceholder
        label="Loading your training"
        blocks={['h-6 w-40', 'h-9 w-64 max-w-full', 'h-44', 'h-40', 'h-40']}
      />
    </PageContainer>
  );
}
