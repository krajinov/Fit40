import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = z.treeifyError(parsed.error);
    console.error('❌ Invalid environment variables:', formatted);
    throw new Error('Invalid environment variables. Check the output above.');
  }

  return parsed.data;
}

export const env = loadEnv();