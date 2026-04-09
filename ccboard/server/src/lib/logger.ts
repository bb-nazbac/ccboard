import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Structured logger using pino.
 *
 * DEV mode:  logs everything (debug level) with pretty formatting to stdout
 * PROD mode: logs warn+ only, JSON format (or disable entirely)
 */
export const log = pino({
  level: isDev ? "debug" : "warn",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          messageFormat: "{msg}",
        },
      }
    : undefined,
});

/** Create a child logger with a fixed context label (e.g. "sse", "jsonl", "reviews") */
export function createLogger(module: string) {
  return log.child({ module });
}
