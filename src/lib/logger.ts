/**
 * Structured logger.
 *
 * - JSON in production, human readable in development.
 * - Every log line carries a `requestId` so a request can be traced end to end
 *   across the web process and the worker process.
 * - Technical detail belongs here. User facing text lives in the i18n files.
 */
import pino, { type Logger } from 'pino';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

function readLevel(): Level {
  const raw = process.env.LOG_LEVEL;
  if (
    raw === 'fatal' ||
    raw === 'error' ||
    raw === 'warn' ||
    raw === 'info' ||
    raw === 'debug' ||
    raw === 'trace' ||
    raw === 'silent'
  ) {
    return raw;
  }
  return 'info';
}

function readPretty(): boolean {
  const raw = process.env.LOG_PRETTY;
  if (raw === undefined) return process.env.NODE_ENV === 'development';
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

const redactPaths = [
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'token',
  'accessToken',
  '*.accessToken',
  'authorization',
  'headers.authorization',
  'cookies',
];

export const logger: Logger = pino({
  level: readLevel(),
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'salesflow' },
  ...(readPretty()
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

/** Returns a logger that stamps every line with the given request id. */
export function withRequestId(requestId: string): Logger {
  return logger.child({ requestId });
}
