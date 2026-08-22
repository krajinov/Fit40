import { z } from 'zod';

const slubPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const programSlugSchema = z.string().regex(slubPattern);
export const weekNumberSchema = z.coerce.number().int().min(1);
export const workoutOrderSchema = z.coerce.number().int().min(1);

export const sessionIdSchema = z.string().min(1);
export const exerciseOrderSchema = z.coerce.number().int().min(1);
export const setNumberSchema = z.coerce.number().int().min(1);

const weightKgSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z.number().finite().min(0).nullable(),
);

const rpeSchema = z.preprocess(
  (v) => (v === '' ? null : v),
  z.number().int().min(1).max(10).nullable(),
);

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