const LOG_PREFIX = "[roam-todoist-backup]";

let debugEnabled = false;

export function setDebugEnabled(value: boolean): void {
  debugEnabled = value;
}

function isDebugEnabled(): boolean {
  return debugEnabled;
}

type LogLevel = "info" | "warn" | "error";

/**
 * Creates a logging function with the specified level and debug requirement.
 *
 * @param level Console log level to use.
 * @param requiresDebug Whether the log should only appear when debug is enabled.
 */
function createLogger(level: LogLevel, requiresDebug: boolean) {
  return (message: string, data?: unknown): void => {
    if (requiresDebug && !isDebugEnabled()) return;

    const logFn = console[level];
    if (data !== undefined) {
      logFn(LOG_PREFIX, message, data);
    } else {
      logFn(LOG_PREFIX, message);
    }
  };
}

/**
 * Logs an informational message when debug mode is enabled.
 *
 * @param message Primary log message.
 * @param data Optional additional context.
 */
export const logInfo = createLogger("info", true);

/**
 * Logs a warning message when debug mode is enabled.
 *
 * @param message Primary warning message.
 * @param data Optional additional context.
 */
export const logWarn = createLogger("warn", true);

/**
 * Logs an error message. Always visible regardless of debug setting.
 *
 * @param message Primary error message.
 * @param error Optional error object or additional context.
 */
export const logError = createLogger("error", false);

/**
 * Logs a debug message with structured data when debug mode is enabled.
 * Use for detailed sync operations, API responses, and data transformations.
 *
 * @param operation Operation being logged (e.g., "fetch_tasks", "write_blocks").
 * @param data Structured data to display.
 */
export function logDebug(operation: string, data: Record<string, unknown>): void {
  if (isDebugEnabled()) {
    console.info(LOG_PREFIX, `[${operation}]`, data);
  }
}

