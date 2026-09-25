import { describe, expect, it } from 'vitest';

import { EnrollmentAlreadyExistsError, EnrollmentIdentityMismatchError } from '@/application/ports/program-enrollment-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createEnrollmentId, createProgramId, createUserId } from '@/domain/types/ids';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';

function enrollment(id: string, userId: string, programId: string, enrolledAt = '2026-01-01T10:00:00Z') {
  const r = createProgramEnrollment({ id, userId, programId, enrolledAt: new Date(enrolledAt) });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function pid(v: string) { const r = createProgramId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

describe('InMemoryProgramEnrollmentRepository', () => {
  it('returns null when the user is not enrolled in the program', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    expect(await repo.findByUserAndProgram(uid('user-1'), pid('program-1'))).toBeNull();
  });

  it('creates and finds an enrollment by user and program', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

    const found = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
    expect(found).not.toBeNull();
    expect(found?.id).toBe('enr-1');
  });

  it('rejects a duplicate enrollment for the same user and program', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

    await expect(repo.create(enrollment('enr-2', 'user-1', 'program-1'))).rejects.toBeInstanceOf(
      EnrollmentAlreadyExistsError,
    );
  });

  it('allows the same program for different users and different programs for one user', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-1', 'user-1', 'program-1'));
    await repo.create(enrollment('enr-2', 'user-2', 'program-1'));
    await repo.create(enrollment('enr-3', 'user-1', 'program-2'));

    expect(await repo.listByUserId(uid('user-1'))).toHaveLength(2);
    expect(await repo.listByUserId(uid('user-2'))).toHaveLength(1);
  });

  it('lists a user\'s enrollments ordered by enrolledAt ascending', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-late', 'user-1', 'program-2', '2026-02-01T10:00:00Z'));
    await repo.create(enrollment('enr-early', 'user-1', 'program-1', '2026-01-01T10:00:00Z'));

    const list = await repo.listByUserId(uid('user-1'));
    expect(list.map((e) => e.id)).toEqual(['enr-early', 'enr-late']);
  });

  it('delete removes the enrollment and reports whether a row existed', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

    expect(await repo.delete(enid('enr-1'))).toBe(true);
    expect(await repo.delete(enid('enr-1'))).toBe(false);
    expect(await repo.findByUserAndProgram(uid('user-1'), pid('program-1'))).toBeNull();
  });

  it('rejoining after delete creates a fresh enrollment identity', async () => {
    const repo = new InMemoryProgramEnrollmentRepository();
    await repo.create(enrollment('enr-1', 'user-1', 'program-1'));
    await repo.delete(enid('enr-1'));
    await repo.create(enrollment('enr-2', 'user-1', 'program-1', '2026-03-01T10:00:00Z'));

    const found = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
    expect(found?.id).toBe('enr-2');
  });

  describe('replaceExpectedWithNew', () => {
    it('replaces the expected enrollment and reports true', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

      const replaced = await repo.replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-2', 'user-1', 'program-1', '2026-04-01T10:00:00Z'),
      );

      expect(replaced).toBe(true);
      // The old identity is gone and cannot be deleted again...
      expect(await repo.delete(enid('enr-1'))).toBe(false);
      // ...the fresh identity is the one live enrollment for the pair...
      const found = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(found?.id).toBe('enr-2');
      expect(found?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');
      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id)).toEqual(['enr-2']);
    });

    it('returns false for a stale expected id and leaves the store untouched', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      // A concurrent replacement already swapped enr-1 for enr-2.
      await repo.create(enrollment('enr-2', 'user-1', 'program-1', '2026-04-01T10:00:00Z'));

      const replaced = await repo.replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-3', 'user-1', 'program-1', '2026-05-01T10:00:00Z'),
      );

      expect(replaced).toBe(false);
      // The newer enrollment was neither deleted nor replaced.
      const found = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(found?.id).toBe('enr-2');
      expect(found?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');
      // And the replacement was not inserted.
      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id)).toEqual(['enr-2']);
    });

    it('returns false when the expected id is unknown', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

      const replaced = await repo.replaceExpectedWithNew(
        enid('enr-missing'),
        enrollment('enr-2', 'user-1', 'program-1'),
      );

      expect(replaced).toBe(false);
      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id)).toEqual(['enr-1']);
    });

    it('throws on a program identity mismatch and leaves the store untouched', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

      await expect(
        repo.replaceExpectedWithNew(enid('enr-1'), enrollment('enr-2', 'user-1', 'program-2')),
      ).rejects.toBeInstanceOf(EnrollmentIdentityMismatchError);

      // The expected enrollment survived and the replacement was not inserted.
      const found = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(found?.id).toBe('enr-1');
      expect(await repo.findByUserAndProgram(uid('user-1'), pid('program-2'))).toBeNull();
      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id)).toEqual(['enr-1']);
    });

    it('throws on a user identity mismatch and leaves the store untouched', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

      await expect(
        repo.replaceExpectedWithNew(enid('enr-1'), enrollment('enr-2', 'user-2', 'program-1')),
      ).rejects.toBeInstanceOf(EnrollmentIdentityMismatchError);

      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id)).toEqual(['enr-1']);
      expect(await repo.listByUserId(uid('user-2'))).toEqual([]);
    });

    it('rejects an id collision as an unexpected error, never as a duplicate enrollment', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));
      // Another user's unrelated enrollment already owns the replacement id.
      await repo.create(enrollment('enr-other', 'user-2', 'program-2'));

      const attempt = repo.replaceExpectedWithNew(
        enid('enr-1'),
        enrollment('enr-other', 'user-1', 'program-1'),
      );

      // Mirrors PostgreSQL: a primary-key collision is a unique violation the
      // repository does NOT translate into EnrollmentAlreadyExistsError.
      await expect(attempt).rejects.not.toBeInstanceOf(EnrollmentAlreadyExistsError);
      await expect(attempt).rejects.toBeInstanceOf(Error);

      // Nothing was overwritten: both rows are exactly as they were.
      const own = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(own?.id).toBe('enr-1');
      const other = await repo.findByUserAndProgram(uid('user-2'), pid('program-2'));
      expect(other?.id).toBe('enr-other');
    });

    it('cannot reach the duplicate-pair guard through any write path (defense-in-depth boundary)', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));
      await repo.create(enrollment('enr-3', 'user-1', 'program-2'));

      // Path 1: create() refuses a duplicate (user, program) pair outright.
      await expect(
        repo.create(enrollment('enr-dup', 'user-1', 'program-1')),
      ).rejects.toBeInstanceOf(EnrollmentAlreadyExistsError);

      // Path 2: a replacement whose pair is owned by ANOTHER row cannot also
      // satisfy the identity guard — the expected row owns a different pair,
      // so the identity mismatch is reported first (in PostgreSQL too, the
      // in-transaction identity check runs before the insert). The
      // duplicate-pair guard therefore stays defense-in-depth for
      // externally-corrupted state, mirroring the Drizzle implementation's
      // constraint-name backstop.
      await expect(
        repo.replaceExpectedWithNew(enid('enr-1'), enrollment('enr-4', 'user-1', 'program-2')),
      ).rejects.toBeInstanceOf(EnrollmentIdentityMismatchError);

      // Store unchanged by both refusals.
      expect((await repo.listByUserId(uid('user-1'))).map((e) => e.id).sort()).toEqual([
        'enr-1',
        'enr-3',
      ]);
    });

    it('clones the replacement on write and on read (value semantics)', async () => {
      const repo = new InMemoryProgramEnrollmentRepository();
      await repo.create(enrollment('enr-1', 'user-1', 'program-1'));

      const next = enrollment('enr-2', 'user-1', 'program-1', '2026-04-01T10:00:00Z');
      expect(await repo.replaceExpectedWithNew(enid('enr-1'), next)).toBe(true);

      // Mutating the caller's aggregate after the write cannot reach stored
      // state (the store holds a clone).
      next.enrolledAt.setTime(0);
      const stored = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(stored?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');

      // Mutating a returned aggregate cannot reach stored state either.
      stored?.enrolledAt.setTime(0);
      const reread = await repo.findByUserAndProgram(uid('user-1'), pid('program-1'));
      expect(reread?.enrolledAt.toISOString()).toBe('2026-04-01T10:00:00.000Z');
    });
  });
});
