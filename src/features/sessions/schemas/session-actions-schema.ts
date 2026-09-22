import { z } from 'zod';

const slubPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const programSlugSchema = z.string().regex(slubPattern);
export const weekNumberSchema = z.coerce.number().int().min(1);
export const workoutOrderSchema = z.coerce.number().int().min(1);

export const sessionIdSchema = z.string().min(1);
export const exerciseOrderSchema = z.coerce.number().int().min(1);
export const setNumberSchema = z.coerce.number().int().min(1);

/**
 * The rendered session snapshot's optimistic-concurrency token (PR #13
 * Finding 1), submitted by every occurrence-addressed mutation form so the
 * use case can reject stale rendered intent BEFORE interpreting the mutable
 * `exerciseOrder`. Fresh sessions start at 0; every successful save bumps it.
 */
export const expectedSessionVersionSchema = z.coerce.number().int().min(0);

/**
 * Optional decimal load. Browser FormData delivers numeric strings ("52.5"),
 * so coerce before validating; '' or an absent field normalizes to null (no
 * load), and a non-numeric string fails validation.
 */
const toNullableNumber = (v: unknown): unknown =>
  v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v;

const weightKgSchema = z.preprocess(toNullableNumber, z.number().finite().min(0).nullable());

/**
 * Optional RPE (1–10). Same FormData coercion as weight; an out-of-range or
 * non-numeric value fails validation rather than being silently dropped.
 */
const rpeSchema = z.preprocess(toNullableNumber, z.number().int().min(1).max(10).nullable());

export const repSetInputSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
  type: z.literal('reps'),
  reps: z.coerce.number().int().positive(),
  weightKg: weightKgSchema,
  rpe: rpeSchema,
});

export const durationSetInputSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
  type: z.literal('duration'),
  durationSeconds: z.coerce.number().int().positive(),
  weightKg: weightKgSchema,
  rpe: rpeSchema,
});

export const logSetSchema = z.discriminatedUnion('type', [repSetInputSchema, durationSetInputSchema]);

export const updateSetSchema = z.discriminatedUnion('type', [
  repSetInputSchema.extend({ setNumber: setNumberSchema }),
  durationSetInputSchema.extend({ setNumber: setNumberSchema }),
]);

export const deleteSetSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
  setNumber: setNumberSchema,
});

export const completeSessionSchema = z.object({
  sessionId: sessionIdSchema,
});

export const startSessionSchema = z.object({
  programSlug: programSlugSchema,
  weekNumber: weekNumberSchema,
  workoutOrder: workoutOrderSchema,
});

/**
 * Substitution: the occurrence to swap and the explicitly selected
 * replacement exercise. No userId — identity comes from the trusted
 * authenticated session, never from client input.
 */
export const substituteExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
  replacementExerciseId: z.string().min(1),
});

/** Restore: the occurrence returned to performed-as-authored identity. */
export const restoreExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
});

/**
 * Skip (M10): the occurrence marked as explicitly not performed in this
 * session. No userId — identity comes from the trusted authenticated
 * session, never from client input.
 */
export const skipExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
});

/** Unskip (M10): the occurrence reverted back to not-skipped. */
export const unskipExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
});

/**
 * Which adjacent neighbor an occurrence swaps with (M10 reordering) — the
 * wire counterpart of the domain's `MoveDirection`.
 */
export const moveDirectionSchema = z.enum(['up', 'down']);

/**
 * Move (M10): the occurrence swapped with its adjacent neighbor. No userId
 * — identity comes from the trusted authenticated session, never from
 * client input.
 */
export const moveExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
  direction: moveDirectionSchema,
});

/**
 * Add Exercise (M11): the explicitly selected catalog exercise plus the
 * explicitly chosen prescription. The client submits ONLY these fields —
 * `userId` comes from the trusted authenticated session, and the domain
 * derives the occurrence order, occurrence key, high-water mark, provenance,
 * authored/performed identities and rest snapshot. The discriminated union
 * makes the two schemes non-interchangeable, so an extra `durationSeconds` on
 * a reps payload (or vice versa) is stripped by the schema and can never
 * drive the persisted prescription.
 */
const addExerciseBaseShape = {
  sessionId: sessionIdSchema,
  exerciseId: z.string().min(1),
  expectedSessionVersion: expectedSessionVersionSchema,
  sets: z.coerce.number().int().positive(),
};

export const addExerciseSchema = z.discriminatedUnion('scheme', [
  z.object({
    ...addExerciseBaseShape,
    scheme: z.literal('reps'),
    targetReps: z.coerce.number().int().positive(),
  }),
  z.object({
    ...addExerciseBaseShape,
    scheme: z.literal('duration'),
    durationSeconds: z.coerce.number().int().positive(),
  }),
]);

/**
 * Remove Exercise (M11): the user-added occurrence to remove, addressed by its
 * business locator and the rendered session version. No userId — identity
 * comes from the trusted authenticated session — and no occurrenceKey,
 * provenance or identity field: those are never command authority.
 */
export const removeExerciseSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
  expectedSessionVersion: expectedSessionVersionSchema,
});