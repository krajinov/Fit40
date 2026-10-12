import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for `/programs/[programSlug]`.
 *
 * Approximates the program header and its section cards, inside the same
 * `pt-10` container the page uses so the layout does not shift when content
 * arrives. Decorative only — no program name, week or workout data is rendered
 * while the aggregate, enrollment and schedule reads resolve.
 */
export default function ProgramDetailLoading() {
  return (
    <PageContainer className="pt-10 md:pt-10">
      <RoutePlaceholder
        label="Loading program details"
        blocks={['h-10 w-72 max-w-full', 'h-5 w-96 max-w-full', 'h-44', 'h-40', 'h-40']}
      />
    </PageContainer>
  );
}
