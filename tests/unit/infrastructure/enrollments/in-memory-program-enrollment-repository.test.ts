import { describe, expect, it } from 'vitest';

import { EnrollmentAlreadyExistsError } from '@/application/ports/program-enrollment-repository';
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
});
