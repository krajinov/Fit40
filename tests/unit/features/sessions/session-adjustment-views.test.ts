/**
 * Unit tests for the M10 skip presentation mapping: affordance states,
 * control/badge/hint/blocked copy, and the eligibility-projection
 * consumption contract.
 *
 * The regression section locks the same rule the M9 substitution mapper
 * follows: the mapper consumes the DOMAIN's eligibility projection and never
 * re-derives blocking from raw fixture facts (set counts, session status,
 * enrollment). Every contradicting fixture below must fail any reintroduced
 * re-derivation logic.
 */

import { describe, expect, it } from 'vitest';

import type { OccurrenceAdjustmentEligibilityDto } from '@/application/dto/workout-session';
import {
  buildSessionAdjustmentView,
  SKIP_BLOCKED_LABEL,
  SKIP_LABEL,
  SKIPPED_BADGE_LABEL,
  SKIPPED_HINT_LABEL,
  UNSKIP_LABEL,
} from '@/features/sessions/session-adjustment-views';

/** The domain-derived eligibility the mapper is expected to consume. */
function eligibility(
  overrides: Partial<OccurrenceAdjustmentEligibilityDto> = {},
): OccurrenceAdjustmentEligibilityDto {
  return {
    isSkipped: false,
    blockedBy: null,
    canSkip: true,
    canUnskip: false,
    ...overrides,
  };
}

describe('session-adjustment-views / buildSessionAdjustmentView', () => {
  it('derives open for a mutable, unskipped occurrence', () => {
    const view = buildSessionAdjustmentView(eligibility());

    expect(view.state).toBe('open');
    expect(view.blockedLabel).toBeNull();
  });

  it('derives skipped for a skipped, mutable occurrence', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ isSkipped: true, canSkip: false, canUnskip: true }),
    );

    expect(view.state).toBe('skipped');
    expect(view.blockedLabel).toBeNull();
  });

  it('derives blocked-logged-sets with the truthful muted copy from the domain block', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ blockedBy: 'logged-sets', canSkip: false }),
    );

    expect(view.state).toBe('blocked-logged-sets');
    expect(view.blockedLabel).toBe(SKIP_BLOCKED_LABEL);
  });

  it('derives hidden for the completed-session block regardless of the skip decision', () => {
    // A skipped occurrence on a completed session: the decision is frozen,
    // so even Undo skip must not render.
    const view = buildSessionAdjustmentView(
      eligibility({
        isSkipped: true,
        blockedBy: 'session-completed',
        canSkip: false,
        canUnskip: false,
      }),
    );

    expect(view.state).toBe('hidden');
    expect(view.blockedLabel).toBeNull();
  });

  it('derives hidden for an unskipped completed-session occurrence too', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ blockedBy: 'session-completed', canSkip: false, canUnskip: false }),
    );

    expect(view.state).toBe('hidden');
  });
});

// Locks the M10 mirror of the M9 review fix: the affordance consumes the
// domain's eligibility projection and never re-derives blocking from raw
// facts. The projection is the mapper's ONLY input, so these tests assert
// that structurally — a mapper that reads anything else cannot compile
// against this contract.
describe('session-adjustment-views / eligibility consumption (M10 regression)', () => {
  it('follows adjustmentEligibility even when raw fixture data suggests otherwise', () => {
    // The eligibility says mutable and unskipped — so `open` — full stop.
    // (A raw DTO with zero sets, an in-progress screen and no substitution
    // would agree here; the point is the mapper never consults any of it.)
    const view = buildSessionAdjustmentView(eligibility());
    expect(view.state).toBe('open');

    // The eligibility alone says blocked — the mapper must not soften it
    // because, say, the DTO happens to carry zero logged sets.
    const blocked = buildSessionAdjustmentView(
      eligibility({ blockedBy: 'logged-sets', canSkip: false }),
    );
    expect(blocked.state).toBe('blocked-logged-sets');

    // The eligibility alone says skipped-and-mutable — the mapper must not
    // hide the undo control for any other reason.
    const skipped = buildSessionAdjustmentView(
      eligibility({ isSkipped: true, canSkip: false, canUnskip: true }),
    );
    expect(skipped.state).toBe('skipped');
  });

  it('never renders a blocked label in an interactive state', () => {
    expect(buildSessionAdjustmentView(eligibility()).blockedLabel).toBeNull();
    expect(
      buildSessionAdjustmentView(eligibility({ isSkipped: true, canUnskip: true }))
        .blockedLabel,
    ).toBeNull();
  });
});

describe('session-adjustment-views / copy constants', () => {
  it('exposes the locked control, badge, hint and blocked copy', () => {
    expect(SKIP_LABEL).toBe('Skip exercise');
    expect(UNSKIP_LABEL).toBe('Undo skip');
    expect(SKIPPED_BADGE_LABEL).toBe('Skipped');
    expect(SKIPPED_HINT_LABEL).toContain('Skipped in this session');
    expect(SKIP_BLOCKED_LABEL).toBe('Delete your logged sets to skip this exercise.');
  });
});
