/**
 * Shared submit factory for session mutation forms (PR #13 Finding 3
 * refactor): collapses the triplicated `applyRouteFields → await action →
 * refresh on stale-server-state codes → return result` body that the
 * adjustment panel's skip, unskip and move paths each used to repeat.
 *
 * It is the `useActionState`-compatible action function React expects
 * (`(prevState, formData) => nextState`): it applies the caller's route
 * fields, invokes the single Server Action, and — ONLY when the action
 * failed with a code that means the rendered page shows stale server state —
 * triggers `router.refresh()`. The staleness decision itself stays
 * centralized in `shouldRefreshAfterSessionMutationError`; this factory adds
 * no policy of its own.
 *
 * Pure with respect to injection: the router is passed in (`refresh`), so a
 * unit test can supply a spy and the Next.js `useRouter()` value drops
 * straight in at the call site.
 */

import { shouldRefreshAfterSessionMutationError } from '@/features/sessions/session-mutation-refresh';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

/** A Server Action returning the shared action-state result. */
export type SessionMutationAction = (formData: FormData) => Promise<SessionActionState>;

/** The `useActionState` action-function shape for a native `<form>`. */
export type SessionMutationSubmit = (
  prevState: SessionActionState,
  formData: FormData,
) => Promise<SessionActionState>;

/** The slice of the Next.js router this factory needs. */
export type SessionRouter = { readonly refresh: () => void };

export function createSessionMutationSubmit(input: {
  readonly router: SessionRouter;
  /** Applies the shared session/route coordinates to every submission. */
  readonly applyRouteFields: (formData: FormData) => void;
  readonly action: SessionMutationAction;
}): SessionMutationSubmit {
  return async (_prev: SessionActionState, formData: FormData): Promise<SessionActionState> => {
    input.applyRouteFields(formData);
    const result = await input.action(formData);
    if (!result.ok && shouldRefreshAfterSessionMutationError(result.error.code)) {
      input.router.refresh();
    }
    return result;
  };
}
