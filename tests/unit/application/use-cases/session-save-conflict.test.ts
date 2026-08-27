/**
 * How a refused session save is translated for the update-path use cases.
 */

import { describe, expect, it } from 'vitest';

import {
  toSessionModifiedError,
} from '@/application/use-cases/session-save-conflict';

describe('toSessionModifiedError', () => {
  it('reports a lost revision race as the typed SESSION_MODIFIED conflict', () => {
    const error = toSessionModifiedError(
      {
        reason: 'concurrent-modification',
        sessionId: 's-1',
        expectedVersion: 3,
      },
      's-1',
    );

    expect(error.code).toBe('SESSION_MODIFIED');
    expect(error.sessionId).toBe('s-1');
    expect(error.message).toContain('revision 3');
  });

  it('throws when an update reports an occurrence conflict, which stored data cannot mean', () => {
    expect(() =>
      toSessionModifiedError(
        { reason: 'scheduled-workout-conflict', scheduledWorkoutId: 'sw-1' },
        's-1',
      ),
    ).toThrowError(/stored sessions are inconsistent/);
  });
});