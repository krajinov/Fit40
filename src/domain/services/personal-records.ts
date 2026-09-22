/**
 * Personal Records (M12) — pure domain semantics over COMPLETED workout
 * history.
 *
 * The domain is the semantic authority for records. It owns metric
 * eligibility, value extraction, the strict comparison rule, chronological
 * event semantics and current-best ownership; infrastructure later supplies
 * optimized exact projections that are verified against THIS implementation,
 * never a second source of truth.
 *
 * Capabilities:
 *
 * 1. `extractRecordCandidates(session)` — one candidate per logged set, keyed
 *    on the occurrence's PERFORMED exercise id, carrying the deterministic
 *    `PerformancePosition` ladder. Skipped and zero-set occurrences produce
 *    nothing (they have no logged sets); duplicate occurrences of one
 *    exercise stay distinguishable by `(sessionId, exerciseOrder, setNumber)`;
 *    provenance and authored identity never affect eligibility.
 * 2. `resolveRecordEvents(entries)` — candidate + exact best value strictly
 *    before it → historical PR event. First exposure and strictly-greater are
 *    events; equal and lower are not. The pairing is the caller's, so the
 *    match is unambiguous even for duplicated exercises, several sets, equal
 *    values and identical timestamps.
 * 3. `foldPersonalRecords(sessions)` — the authoritative chronological fold
 *    that derives both historical events and current personal bests from full
 *    eligible history. It reuses the same primitives as (1) and (2), so the
 *    three capabilities cannot drift apart. Later slices use it as the
 *    integration-test oracle for the optimized SQL projections.
 *
 * Current-best semantics: the maximum eligible value per (performed exercise,
 * metric) wins, and on tied maxima the EARLIEST position in the ladder owns
 * the best — a later equal performance never replaces the owner.
 *
 * Completed-only boundary: records are historical evidence, so both entry
 * points accept the domain's `WorkoutSession` aggregate and explicitly reject
 * an in-progress one (`completedAt === null`) with `SESSION_NOT_COMPLETED`
 * instead of silently treating it as completed history. A caller holding the
 * application layer's completed-session projection (non-null `completedAt`)
 * passes it unchanged. Completion behavior itself is untouched.
 *
 * Out of scope by design: volume/estimated-1RM/working-load/RPE records,
 * streaks, achievements, persistence, formatting and UI. Records are
 * independent of the M8 progression engine in both directions: the engine's
 * inputs and outputs never include anything from here.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import {
  comparePerformancePositions,
  establishesPersonalRecord,
  toRecordCandidate,
  type PerformancePosition,
  type RecordCandidate,
  type RecordMetric,
} from '@/domain/services/personal-record-metrics';
import type { ExerciseId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Expected personal-record failures. An in-progress aggregate is rejected
 * explicitly: records are derived from completed history only.
 */
export interface PersonalRecordError {
  readonly code: 'SESSION_NOT_COMPLETED';
  readonly message: string;
}

function sessionNotCompleted(session: WorkoutSession): PersonalRecordError {
  return {
    code: 'SESSION_NOT_COMPLETED',
    message: `Personal records require a completed session; session "${session.id}" is still in progress`,
  };
}

// ─── Results ─────────────────────────────────────────────────────────────────

/**
 * One historical personal-record event: a performance that strictly exceeded
 * every eligible performance chronologically before it. `previousBest` is the
 * best value strictly before this performance, or null for a first exposure —
 * honest context for later slices to render; the domain never formats it.
 */
export interface RecordEvent {
  readonly exerciseId: ExerciseId;
  readonly metric: RecordMetric;
  readonly value: number;
  readonly position: PerformancePosition;
  readonly previousBest: number | null;
}

/**
 * The current personal best of one (performed exercise, metric) pair. On tied
 * all-time maxima the earliest position owns the best; the fields carry
 * enough identity to locate the exact winning performance.
 */
export interface PersonalBest {
  readonly exerciseId: ExerciseId;
  readonly metric: RecordMetric;
  readonly value: number;
  readonly position: PerformancePosition;
}

/** One candidate paired with the exact best eligible value strictly before it. */
export interface CandidatePriorBest {
  readonly candidate: RecordCandidate;
  readonly bestBefore: number | null;
}

/** The chronological fold's result: events oldest-first plus current bests. */
export interface PersonalRecordHistory {
  readonly events: ReadonlyArray<RecordEvent>;
  readonly currentBests: ReadonlyArray<PersonalBest>;
}

// ─── Candidate extraction ────────────────────────────────────────────────────

/**
 * Extracts every eligible record candidate of one COMPLETED session, oldest
 * first by the position ladder (occurrences are read in canonical order, then
 * sets by set number). The session aggregate is never mutated; a skipped or
 * zero-set occurrence simply contributes no candidate.
 */
export function extractRecordCandidates(
  session: WorkoutSession,
): Result<ReadonlyArray<RecordCandidate>, PersonalRecordError> {
  const completedAt = session.completedAt;
  if (completedAt === null) {
    return err(sessionNotCompleted(session));
  }

  const candidates: RecordCandidate[] = [];
  for (const log of session.exerciseLogs) {
    for (const set of log.sets) {
      candidates.push(
        toRecordCandidate(log.performedExerciseId, set, {
          completedAt,
          startedAt: session.startedAt,
          sessionId: session.id,
          exerciseOrder: log.order,
          setNumber: set.setNumber,
        }),
      );
    }
  }

  // The sort is on POSITIONS, not candidates: the comparator's contract is the
  // `PerformancePosition` ladder, so the wrapper is what keeps the documented
  // oldest-first ordering true instead of comparing candidates directly.
  return ok(
    candidates.sort((a, b) => comparePerformancePositions(a.position, b.position)),
  );
}

// ─── Historical event resolution ─────────────────────────────────────────────

/**
 * Resolves which candidates establish a historical PR event, given the exact
 * best eligible value strictly before each candidate (an infrastructure
 * projection in later slices; the fold computes it in-memory here). Input
 * order is preserved, so the result is deterministic.
 */
export function resolveRecordEvents(
  entries: ReadonlyArray<CandidatePriorBest>,
): ReadonlyArray<RecordEvent> {
  const events: RecordEvent[] = [];
  for (const { candidate, bestBefore } of entries) {
    if (!establishesPersonalRecord(candidate.value, bestBefore)) continue;
    events.push({
      exerciseId: candidate.exerciseId,
      metric: candidate.metric,
      value: candidate.value,
      position: candidate.position,
      previousBest: bestBefore,
    });
  }
  return events;
}

// ─── Chronological fold ──────────────────────────────────────────────────────

/** A session validated as completed, so the fold can order it by instant. */
interface CompletedSession {
  readonly session: WorkoutSession;
  readonly completedAt: Date;
}

/**
 * NUL-joined (exercise, metric) key: neither a metric name nor a realistic
 * exercise id contains the separator, so distinct pairs never collide.
 */
function metricKey(exerciseId: ExerciseId, metric: RecordMetric): string {
  return `${exerciseId}\u0000${metric}`;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareCompletedSessions(a: CompletedSession, b: CompletedSession): number {
  return (
    a.completedAt.getTime() - b.completedAt.getTime() ||
    a.session.startedAt.getTime() - b.session.startedAt.getTime() ||
    compareStrings(a.session.id, b.session.id)
  );
}

function comparePersonalBests(a: PersonalBest, b: PersonalBest): number {
  return compareStrings(a.exerciseId, b.exerciseId) || compareStrings(a.metric, b.metric);
}

/**
 * The authoritative chronological fold (oldest → newest) over completed
 * sessions. Events come out in chronological order; current bests are in the
 * canonical (exercise id, metric) order. Every session must be completed —
 * one in-progress aggregate fails the whole fold rather than being silently
 * dropped from history.
 */
export function foldPersonalRecords(
  sessions: ReadonlyArray<WorkoutSession>,
): Result<PersonalRecordHistory, PersonalRecordError> {
  const ordered: CompletedSession[] = [];
  for (const session of sessions) {
    if (session.completedAt === null) {
      return err(sessionNotCompleted(session));
    }
    ordered.push({ session, completedAt: session.completedAt });
  }
  ordered.sort(compareCompletedSessions);

  const bestByKey = new Map<string, PersonalBest>();
  const events: RecordEvent[] = [];

  for (const entry of ordered) {
    const extracted = extractRecordCandidates(entry.session);
    if (!extracted.ok) {
      return err(extracted.error);
    }

    // Candidates are resolved ONE AT A TIME in position order. Within a single
    // session an earlier set is genuinely "strictly before" a later one, so the
    // running best map — the only source of `bestBefore` — must be updated
    // between candidates. Resolving a whole session against one snapshot would
    // let repeated or equal sets each claim a record.
    for (const candidate of extracted.data) {
      const key = metricKey(candidate.exerciseId, candidate.metric);
      const event = resolveRecordEvents([
        { candidate, bestBefore: bestByKey.get(key)?.value ?? null },
      ])[0];
      if (event === undefined) continue;

      events.push(event);
      bestByKey.set(key, {
        exerciseId: event.exerciseId,
        metric: event.metric,
        value: event.value,
        position: event.position,
      });
    }
  }

  const currentBests = [...bestByKey.values()].sort(comparePersonalBests);
  return ok({ events, currentBests });
}
