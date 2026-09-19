/**
 * The set logger's editable field values, lifted OUT of `SetLoggerForm` so the
 * Active Workout OCCURRENCE BOUNDARY (PR #13 P2) can own a draft without
 * importing a client component module — and so the boundary does not depend on
 * the form being unmocked in a test.
 *
 * Values are strings, mirroring the controlled inputs. When the boundary owns
 * the draft it survives a representation change (full card ⇄ compact upcoming
 * row); when omitted, `SetLoggerForm` keeps its own state exactly as before.
 */
export interface SetLoggerDraft {
  readonly weight: string;
  readonly count: string;
  readonly rpe: string;
}

/** The initial draft from the resolved prefill (empty RPE — never prefilled). */
export function setLoggerDraftFromPrefill(
  prefillWeightKg: number | null,
  prefillSeconds: number | null,
): SetLoggerDraft {
  return {
    weight: prefillWeightKg === null ? '' : String(prefillWeightKg),
    count: prefillSeconds === null ? '' : String(prefillSeconds),
    rpe: '',
  };
}