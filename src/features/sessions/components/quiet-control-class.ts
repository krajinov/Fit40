/**
 * The quiet-pill styling shared by every control of the occurrence
 * adjustment panel (skip/unskip and move up/down) — and by the swap panel's
 * restore control, which uses the identical visual treatment. Kept in one
 * place so the split control islands cannot drift apart (PR #13 Finding 3
 * refactor).
 */
export const QUIET_CONTROL_CLASS =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50';
