import { describe, expect, it, vi } from 'vitest';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { ListUserEnrollmentsUseCase } from '@/application/use-cases/list-user-enrollments';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';

function enroll(repo: InMemoryProgramEnrollmentRepository, enrollmentId: string, userId: string, programId: string, enrolledAt: string) {
  const r = createProgramEnrollment({ id: enrollmentId, userId, programId, enrolledAt: new Date(enrolledAt) });
  if (!r.ok) throw Error();
  return repo.create(r.data);
}

function makeUseCase(
  metadata: ReadonlyArray<{ id: string; slug: string; name: string }> = [
    { id: 'p1', slug: 'prog-1', name: 'Program One' },
    { id: 'p2', slug: 'prog-2', name: 'Program Two' },
  ],
) {
  const programRepo: ProgramRepository = {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn().mockResolvedValue(metadata),
  };
  const enrollmentRepo = new InMemoryProgramEnrollmentRepository();
  const uc = new ListUserEnrollmentsUseCase(enrollmentRepo, programRepo);
  return { enrollmentRepo, programRepo, uc };
}

describe('ListUserEnrollmentsUseCase', () => {
  it('returns an empty list when the user has no enrollments', async () => {
    const { programRepo, uc } = makeUseCase();
    expect(await uc.execute('user-a')).toEqual([]);
    // Nothing enrolled: the metadata query must not run at all.
    expect(programRepo.listMetadataByIds).not.toHaveBeenCalled();
  });

  it('lists only the given user\'s enrollments with program metadata, ordered by enrollment time', async () => {
    const { enrollmentRepo, programRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-2', 'user-a', 'p2', '2026-02-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-3', 'user-b', 'p1', '2026-01-15T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result).toEqual([
      { programId: 'p1', programSlug: 'prog-1', programName: 'Program One', enrolledAt: '2026-01-01T10:00:00.000Z' },
      { programId: 'p2', programSlug: 'prog-2', programName: 'Program Two', enrolledAt: '2026-02-01T10:00:00.000Z' },
    ]);
    // The metadata query is scoped to exactly this user's enrolled programs.
    expect(programRepo.listMetadataByIds).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('requests metadata only for the enrolled programs, never the full catalog', async () => {
    const { enrollmentRepo, programRepo, uc } = makeUseCase();
    await enroll(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-2', 'user-b', 'p2', '2026-01-02T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result).toEqual([
      { programId: 'p1', programSlug: 'prog-1', programName: 'Program One', enrolledAt: '2026-01-01T10:00:00.000Z' },
    ]);
    expect(programRepo.listMetadataByIds).toHaveBeenCalledTimes(1);
    expect(programRepo.listMetadataByIds).toHaveBeenCalledWith(['p1']);
    // The expensive aggregate-hydration paths stay untouched.
    expect(programRepo.list).not.toHaveBeenCalled();
    expect(programRepo.findBySlug).not.toHaveBeenCalled();
    expect(programRepo.findSessionRouteByScheduledWorkoutId).not.toHaveBeenCalled();
  });

  it('skips enrollments whose program metadata cannot be resolved', async () => {
    const { enrollmentRepo, uc } = makeUseCase([{ id: 'p1', slug: 'prog-1', name: 'Program One' }]);
    await enroll(enrollmentRepo, 'enr-1', 'user-a', 'p1', '2026-01-01T10:00:00Z');
    await enroll(enrollmentRepo, 'enr-2', 'user-a', 'p2', '2026-02-01T10:00:00Z');

    const result = await uc.execute('user-a');

    expect(result).toEqual([
      { programId: 'p1', programSlug: 'prog-1', programName: 'Program One', enrolledAt: '2026-01-01T10:00:00.000Z' },
    ]);
  });
});
