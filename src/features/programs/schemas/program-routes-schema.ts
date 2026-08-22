/**
 * Route parameter validation for program pages.
 *
 * Invalid values are surfaced through Zod and mapped to notFound() by routes.
 */

import { z } from 'zod';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const programSlugSchema = z.string().regex(SLUG_PATTERN);

export const weekNumberSchema = z.coerce.number().int().min(1);

export const workoutOrderSchema = z.coerce.number().int().min(1);