import { PageContainer } from '@/components/shared/PageContainer';
import { RoutePlaceholder } from '@/components/shared/RoutePlaceholder';

/**
 * M19 S2 — loading boundary for the active workout session route.
 *
 * Approximates the session header and main workout content inside the same
 * `pb-6 md:pb-20` container the page uses. Session-specific mobile navigation
 * is untouched: the shell's tab bar already hides itself on `/session` routes
 * and the layout's 76px bottom clearance already reserves the finish bar's
 * space, so this placeholder renders no bottom bar of its own and simply sits
 * in the reserved frame. Decorative only — no workout, set or exercise data is
 * rendered while the view resolves.
 */
export default function SessionLoading() {
  return (
    <PageContainer className="pb-6 md:pb-20">
      <RoutePlaceholder
        label="Loading workout session"
        blocks={['h-6 w-56 max-w-full', 'h-10 w-72 max-w-full', 'h-32', 'h-44', 'h-44', 'h-40']}
      />
    </PageContainer>
  );
}
