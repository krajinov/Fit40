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
  MOVE_DOWN_LABEL,
  MOVE_UP_LABEL,
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
    // The move flags ride along on the projection (M10 Slice 5); a neutral
    // mid-list value keeps every fixture freely movable unless a test
    // overrides it.
    canMoveUp: true,
    canMoveDown: true,
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

// ─── Move affordance (M10 Slice 6) ────────────────────────────────────────────
//
// The move flags are COPIED, never derived: the mapper's only input is the
// eligibility DTO, so these fixtures prove it renders whatever adjacency the
// domain projected — a mid-list `open` occurrence with both flags false must
// show no move controls, and a first-position flag combination arrives only
// via the DTO. Any reintroduced position/skip/set-count re-derivation fails
// these tests.
describe('session-adjustment-views / move affordance (M10 Slice 6)', () => {
  it('copies the first-occurrence flags: no move up, move down', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ canMoveUp: false, canMoveDown: true }),
    );

    expect(view.canMoveUp).toBe(false);
    expect(view.canMoveDown).toBe(true);
    expect(view.state).toBe('open');
  });

  it('copies the mid-list flags: both moves', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ canMoveUp: true, canMoveDown: true }),
    );

    expect(view.canMoveUp).toBe(true);
    expect(view.canMoveDown).toBe(true);
  });

  it('copies the last-occurrence flags: move up, no move down', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ canMoveUp: true, canMoveDown: false }),
    );

    expect(view.canMoveUp).toBe(true);
    expect(view.canMoveDown).toBe(false);
  });

  it('copies the single-occurrence flags: no move controls at all', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ canMoveUp: false, canMoveDown: false }),
    );

    expect(view.canMoveUp).toBe(false);
    expect(view.canMoveDown).toBe(false);
  });

  it('preserves the move flags on a skipped occurrence (a skip may still move)', () => {
    const view = buildSessionAdjustmentView(
      eligibility({ isSkipped: true, canSkip: false, canUnskip: true }),
    );

    expect(view.state).toBe('skipped');
    expect(view.canMoveUp).toBe(true);
    expect(view.canMoveDown).toBe(true);
  });

  it('preserves the move flags when logged sets block the skip decision', () => {
    // Logged sets freeze the skip decision ONLY — the move flags must ride
    // along untouched so the panel can render the blocked copy AND the
    // move controls at once.
    const view = buildSessionAdjustmentView(
      eligibility({
        blockedBy: 'logged-sets',
        canSkip: false,
        canMoveUp: false,
        canMoveDown: true,
      }),
    );

    expect(view.state).toBe('blocked-logged-sets');
    expect(view.blockedLabel).toBe(SKIP_BLOCKED_LABEL);
    expect(view.canMoveUp).toBe(false);
    expect(view.canMoveDown).toBe(true);
  });

  it('maps a completed session to hidden — no adjustment mutation controls at all', () => {
    // Even with both move flags still true in the raw projection (the
    // mapper must not consult them for the state), completion hides every
    // mutation affordance.
    const view = buildSessionAdjustmentView(
      eligibility({
        blockedBy: 'session-completed',
        canSkip: false,
        canUnskip: false,
        canMoveUp: true,
        canMoveDown: true,
      }),
    );

    expect(view.state).toBe('hidden');
    expect(view.blockedLabel).toBeNull();
  });

  it('never derives the move flags from the fixture position or skip state', () => {
    // A contradictory fixture: an `open`, mutable, mid-list-looking
    // occurrence whose domain projection says it cannot move at all. The
    // mapper must render exactly those flags — never soften them because
    // the state suggests otherwise.
    const view = buildSessionAdjustmentView(
      eligibility({ canMoveUp: false, canMoveDown: false }),
    );

    expect(view.state).toBe('open');
    expect(view.canMoveUp).toBe(false);
    expect(view.canMoveDown).toBe(false);
  });
});

describe('session-adjustment-views / copy constants', () => {
  it('exposes the locked control, badge, hint and blocked copy', () => {
    expect(SKIP_LABEL).toBe('Skip exercise');
    expect(UNSKIP_LABEL).toBe('Undo skip');
    expect(MOVE_UP_LABEL).toBe('Move up');
    expect(MOVE_DOWN_LABEL).toBe('Move down');
    expect(SKIPPED_BADGE_LABEL).toBe('Skipped');
    expect(SKIPPED_HINT_LABEL).toContain('Skipped in this session');
    expect(SKIP_BLOCKED_LABEL).toBe('Delete your logged sets to skip this exercise.');
  });
});
