/**
 * Environment configuration.
 *
 * Rules:
 *  - No secret ever lives in the repository; everything comes from the process
 *    environment (`.env` locally, real env vars in production).
 *  - Parsing is lazy and memoized so that `next build` does not require a
 *    populated environment, while the running app fails fast on the first use.
 *  - `parseEnv` is a pure function so it can be unit tested directly.
 */
import 'dotenv/config';
import { z } from 'zod';

/** Treats "true"/"1"/"yes" as true and "false"/"0"/"no" as false. */
const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return value;
}, z.boolean());

const placeholder = 'CHANGE_ME';

const envSchema = z
  .object({
    // core
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.string().url().default('http://localhost:3000'),

    // database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    TEST_DATABASE_URL: z.string().min(1).optional(),

    // auth (Phase 1)
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).max(1048576).default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(16).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),
    LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().min(1).max(1000).default(10),
    LOGIN_MAX_ATTEMPTS_PER_ACCOUNT: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    // uploads (Phase 8)
    UPLOAD_DIR: z.string().default('/data/uploads'),
    MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(100).default(5),

    // signed links (Phase 6)
    SIGNED_LINK_SECRET: z.string().min(32, 'SIGNED_LINK_SECRET must be at least 32 characters'),
    SIGNED_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(8760).default(168),

    // whatsapp (Phase 9)
    WHATSAPP_ENABLED: booleanFromEnv.default(false),
    WHATSAPP_PROVIDER: z.enum(['cloud', 'console']).default('console'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_API_VERSION: z.string().optional(),
    WHATSAPP_API_BASE_URL: z.string().optional(),

    // e-invoice (Phase 12, structure only)
    EINVOICE_ENABLED: booleanFromEnv.default(false),
    EINVOICE_GATEWAY_URL: z.string().optional(),
    EINVOICE_GATEWAY_TOKEN: z.string().optional(),

    // observability
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromEnv.default(false),

    // seed only
    SEED_ADMIN_USERNAME: z.string().default('admin'),
    SEED_ADMIN_PHONE: z.string().default('+201000000000'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeMe!123'),
  })
  .superRefine((value, ctx) => {
    // Placeholder secrets must never reach production.
    if (value.NODE_ENV === 'production') {
      if (value.AUTH_SECRET.includes(placeholder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_SECRET'],
          message: 'placeholder secret in production',
        });
      }
      if (value.SIGNED_LINK_SECRET.includes(placeholder)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SIGNED_LINK_SECRET'],
          message: 'placeholder secret in production',
        });
      }
    }

    // The cloud provider is useless without credentials, and silently drops
    // messages when they are missing. Never start in that state.
    if (
      value.WHATSAPP_PROVIDER === 'cloud' &&
      !(value.WHATSAPP_PHONE_NUMBER_ID && value.WHATSAPP_ACCESS_TOKEN)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_ACCESS_TOKEN'],
        message: 'cloud provider requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN',
      });
    }

    // The console provider only prints. Using it in production with WhatsApp
    // turned on would silently drop every message.
    if (
      value.NODE_ENV === 'production' &&
      value.WHATSAPP_ENABLED &&
      value.WHATSAPP_PROVIDER === 'console'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_PROVIDER'],
        message: 'console provider is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Pure parser: given a source object, return a validated environment. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Memoized accessor used by the running application. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Throws immediately if the environment is unusable. */
export function validateEnv(): Env {
  return getEnv();
}
