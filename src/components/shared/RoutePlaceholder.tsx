import { cn } from '@/lib/utils';

/**
 * RoutePlaceholder — the single shared loading primitive (M19 S2).
 *
 * One `loading.tsx` per target route composes this with `PageContainer` and a
 * route-appropriate `blocks` list, so each route approximates its own geometry
 * without a skeleton framework and without duplicated markup.
 *
 * Guarantees:
 * - Geometry only. Blocks render no text, digits, dates, metrics or exercise
 *   names — a decorative surface (`SectionCard` radius + border and the
 *   `bg-surface-2/50` treatment proven at `exercises/page.tsx`) so a loading
 *   frame can never fabricate workout data.
 * - Exactly ONE accessible loading status: a `role="status"` (implicitly
 *   `aria-live="polite"`) region carrying only the label. A route never renders
 *   a second competing live region. Blocks are `aria-hidden`, so assistive tech
 *   announces the status and skips the decorative geometry.
 * - No animation (nothing to reduce under `prefers-reduced-motion`).
 * - Server-compatible: no hooks, no `"use client"`.
 *
 * The container defaults to a single-column grid; a route may pass `className`
 * (e.g. `md:grid-cols-2`) and `col-span-*` per block for richer composition.
 */
export interface RoutePlaceholderProps {
  /**
   * Short, factual loading status (announced politely). Never a number, metric
   * or fabricated value — e.g. "Loading your training".
   */
  readonly label: string;
  /**
   * Decorative block geometry. Each entry is Tailwind classes merged onto a
   * hidden surface block: use it for height and, in a grid, column spans. No
   * content.
   */
  readonly blocks?: readonly string[];
  /** Container classes: adjust the layout (e.g. add `md:grid-cols-2`) or spacing. */
  readonly className?: string;
}

export function RoutePlaceholder({ label, blocks = [], className }: RoutePlaceholderProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-5 md:gap-6', className)}>
      {/* The route's single polite live region: label text only. */}
      <p role="status" className="sr-only">
        {label}
      </p>
      {blocks.map((block, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn('h-24 rounded-card border border-border bg-surface-2/50', block)}
        />
      ))}
    </div>
  );
}
