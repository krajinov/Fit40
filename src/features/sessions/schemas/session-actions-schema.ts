import { z } from 'zod';

const slubPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const programSlugSchema = z.string().regex(slubPattern);
export const weekNumberSchema = z.coerce.number().int().min(1);
export const workoutOrderSchema = z.coerce.number().int().min(1);

export const sessionIdSchema = z.string().min(1);
export const exerciseOrderSchema = z.coerce.number().int().min(1);
export const setNumberSchema = z.coerce.number().int().min(1);

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
  type: z.literal('reps'),
  reps: z.coerce.number().int().positive(),
  weightKg: weightKgSchema,
  rpe: rpeSchema,
});

export const durationSetInputSchema = z.object({
  sessionId: sessionIdSchema,
  exerciseOrder: exerciseOrderSchema,
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