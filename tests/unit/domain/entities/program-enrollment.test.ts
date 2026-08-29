/**
 * Tests for the ProgramEnrollment domain entity factory.
 */

import { describe, expect, it } from 'vitest';

import { createProgramEnrollment } from '@/domain/entities/program-enrollment';

function makeValidInput() {
  return {
    id: 'enrollment-1',
    userId: 'user-1',
    programId: 'program-1',
    enrolledAt: new Date('2026-01-01T10:00:00Z'),
  };
}

describe('createProgramEnrollment', () => {
  it('creates a valid enrollment', () => {
    const result = createProgramEnrollment(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('enrollment-1');
    expect(result.data.userId).toBe('user-1');
    expect(result.data.programId).toBe('program-1');
    expect(result.data.enrolledAt).toEqual(new Date('2026-01-01T10:00:00Z'));
  });

  it('rejects an empty id', () => {
    const result = createProgramEnrollment({ ...makeValidInput(), id: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ENROLLMENT');
    expect(result.error.field).toBe('id');
  });

  it('rejects an empty userId', () => {
    const result = createProgramEnrollment({ ...makeValidInput(), userId: '  ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ENROLLMENT');
    expect(result.error.field).toBe('userId');
  });

  it('rejects an empty programId', () => {
    const result = createProgramEnrollment({ ...makeValidInput(), programId: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ENROLLMENT');
    expect(result.error.field).toBe('programId');
  });

  it('rejects an invalid enrolledAt date', () => {
    const result = createProgramEnrollment({
      ...makeValidInput(),
      enrolledAt: new Date('not-a-date'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_ENROLLMENT');
    expect(result.error.field).toBe('enrolledAt');
  });
});
