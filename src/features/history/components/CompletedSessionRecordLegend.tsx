/**
 * Explanation of the historical Personal Record indicator on a completed
 * session's set rows (the M12 Slice 4 badge, explained since the post-M12
 * polish pass).
 *
 * The session page renders this only when the view reports that a badge is
 * actually on screen — the screen never explains a marker it does not show.
 * The wording is deliberately explicit about "at the time": the badge records
 * what happened then and is not a claim about today's personal best.
 */
export function CompletedSessionRecordLegend() {
  return (
    <p className="mt-3 text-xs text-ink-3 md:mt-4">
      PR marks the set that established a personal record for that exercise at the time.
    </p>
  );
}