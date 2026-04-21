/**
 * Centralized logging module for Ask262 MCP server.
 *
 * Provides structured JSON logging with OpenTelemetry-style tracing support.
 * Uses Pino for high-performance logging with dual output:
 * - File: JSON Lines format for DuckDB querying
 * - Console: Pretty-printed for development visibility
 *
 * @module lib/logger
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import pretty from "pino-pretty";
import { getTraceContext } from "./tracing.js";

/**
 * Log levels supported by the logger.
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/**
 * Standardized operation names for logging.
 * Using an enum ensures consistency across the codebase.
 *
 * Tense conventions:
 * - Present continuous (-ing) for timed operations that have start/end
 * - Past tense for lifecycle events and completion states
 * - Tool names for MCP tool invocations (logged at info level)
 */
export enum LogOperation {
  // Server lifecycle (past tense for events)
  SERVER_STARTED = "server_started",
  SERVER_STOPPED = "server_stopped",

  // HTTP handling (present continuous for timed request handling)
  HANDLING_MCP_HTTP_REQUEST = "handling_mcp_http_request",

  // MCP Tool invocations (tool names, logged at info level)
  SEARCH_SPEC_SECTIONS = "search_spec_sections",
  GET_SECTION_CONTENT = "get_section_content",
  EVALUATE_IN_ENGINE262 = "evaluate_in_engine262",

  // MCP Tool spans (present continuous tense of tool names)
  // Note: These are the same as the timed operation names below for consistency

  // Vector search operations (present continuous)
  SEARCHING_SPEC_SECTIONS = "searching_spec_sections",
  GENERATING_EMBEDDING = "generating_embedding",
  QUERYING_LANCEDB = "querying_lancedb",

  // Section fetch operations (present continuous)
  FETCHING_SECTION_CONTENT = "fetching_section_content",
  QUERYING_TABLE = "querying_table",

  // Code execution operations (present continuous for timed)
  EVALUATING_IN_ENGINE262 = "evaluating_in_engine262",
  SPAWNING_CHILD_PROCESS = "spawning_child_process",
  // Completion states (engine262 spec terminology - normal/abrupt completion)
  ENGINE262_NORMAL_COMPLETION = "engine262_normal_completion",
  ENGINE262_ABRUPT_COMPLETION = "engine262_abrupt_completion",

  // Reranking operations (present continuous)
  RERANKING_DOCUMENTS = "reranking_documents",

  // Graph exploration (present continuous for actions, past for results)
  EXPLORING_GRAPH = "exploring_graph",
  RESOLVING_NODE_ID = "resolving_node_id",
  NODE_FOUND = "node_found",
  NODE_NOT_FOUND = "node_not_found",

  // Embedding batch operations (present continuous)
  EMBEDDING_DOCUMENTS = "embedding_documents",
  PROCESSING_EMBEDDING_BATCH = "processing_embedding_batch",
  RETRYING_RATE_LIMIT = "retrying_rate_limit",
}

/**
 * Numeric log level values (Pino convention).
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/**
 * Valid log level strings.
 */
const VALID_LOG_LEVELS: LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
];

/**
 * Components that can log in the application.
 */
export type LogComponent =
  | "http-server"
  | "stdio-server"
  | "search-tool"
  | "get-section-tool"
  | "engine262-runner"
  | "reranker"
  | "graph-explorer"
  | "embeddings-factory"
  | "fireworks-embeddings";

/**
 * Get the file log level from environment.
 * HTTP server defaults to 'debug', stdio defaults to 'info'.
 *
 * @returns The configured file log level
 */
function getFileLogLevel(): LogLevel {
  const envLevel = process.env.ASK262_LOG_LEVEL?.toLowerCase();
  if (envLevel && VALID_LOG_LEVELS.includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }
  // Default: debug for HTTP, info for stdio
  return "debug";
}

/**
 * Get the console log level.
 * Console shows max('info', file level) - never shows debug.
 *
 * @returns The calculated console log level
 */
function getConsoleLogLevel(): LogLevel {
  const fileLevel = getFileLogLevel();
  const fileLevelValue = LOG_LEVEL_VALUES[fileLevel];
  const infoLevelValue = LOG_LEVEL_VALUES.info;

  // Console level is max of (info, file level)
  return fileLevelValue > infoLevelValue ? fileLevel : "info";
}

/**
 * Get the log directory from environment.
 *
 * @returns The configured log directory path
 */
function getLogDir(): string {
  return process.env.ASK262_LOG_DIR ?? "./logs";
}

/**
 * Ensure the log directory exists.
 * Creates the directory recursively if it doesn't exist.
 *
 * @throws Error if directory cannot be created
 */
async function ensureLogDir(): Promise<void> {
  const logDir = getLogDir();
  try {
    await mkdir(logDir, { recursive: true });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to create log directory '${logDir}': ${errorMsg}. ` +
        "Check permissions or set ASK262_LOG_DIR to a writable location.",
    );
  }
}

/**
 * Fields to redact from logs for security.
 */
const REDACT_FIELDS = [
  "FIREWORKS_API_KEY",
  "api_key",
  "authorization",
  "password",
  "secret",
  "token",
];

/**
 * Create the root Pino logger instance.
 *
 * @returns Configured Pino logger with dual transport
 */
async function createRootLogger(): Promise<pino.Logger> {
  await ensureLogDir();

  const logDir = getLogDir();
  const logFile = join(logDir, "ask262.jsonl");

  const fileLevel = getFileLogLevel();
  const consoleLevel = getConsoleLogLevel();

  // File transport: JSON Lines format, synchronous writes
  const fileStream = createWriteStream(logFile, { flags: "a" });

  // Console transport: Pretty printed
  const consoleStream = pretty({
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  });

  return pino(
    {
      level: fileLevel,
      redact: {
        paths: REDACT_FIELDS,
        remove: true,
        censor: "[REDACTED]",
      },
      mixin() {
        // Add trace context if available
        const traceCtx = getTraceContext();
        if (traceCtx) {
          return {
            trace_id: traceCtx.traceId,
            span_id: traceCtx.spanId,
            parent_span_id: traceCtx.parentSpanId,
          };
        }
        return {};
      },
      formatters: {
        level(label: string) {
          return { level: label };
        },
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    },
    pino.multistream([
      { stream: fileStream, level: fileLevel },
      { stream: consoleStream, level: consoleLevel },
    ]),
  );
}

// Singleton root logger instance
let rootLogger: pino.Logger | null = null;

/**
 * Get or create the root logger instance.
 *
 * @returns The root logger
 */
async function getRootLogger(): Promise<pino.Logger> {
  if (!rootLogger) {
    rootLogger = await createRootLogger();
  }
  return rootLogger;
}

/**
 * Interface for timed operations.
 */
export interface TimedOperation {
  /**
   * End the timed operation and log the result.
   *
   * @param resultAttrs - Additional attributes to log with the result
   */
  end(resultAttrs?: Record<string, unknown>): void;
}

/**
 * Interface for component-bound loggers.
 */
export interface ComponentLogger {
  /**
   * Log at trace level.
   *
   * @param operation - The operation being performed (use LogOperation enum)
   * @param attrs - Additional attributes
   */
  trace(
    operation: LogOperation | string,
    attrs?: Record<string, unknown>,
  ): void;

  /**
   * Log at debug level.
   *
   * @param operation - The operation being performed (use LogOperation enum)
   * @param attrs - Additional attributes
   */
  debug(
    operation: LogOperation | string,
    attrs?: Record<string, unknown>,
  ): void;

  /**
   * Log at info level.
   *
   * @param operation - The operation being performed (use LogOperation enum)
   * @param attrs - Additional attributes
   */
  info(operation: LogOperation | string, attrs?: Record<string, unknown>): void;

  /**
   * Log at warn level.
   *
   * @param operation - The operation being performed (use LogOperation enum)
   * @param attrs - Additional attributes
   */
  warn(operation: LogOperation | string, attrs?: Record<string, unknown>): void;

  /**
   * Log at error level.
   *
   * @param operation - The operation being performed (use LogOperation enum)
   * @param attrs - Additional attributes
   * @param error - Optional error to include
   */
  error(
    operation: LogOperation | string,
    attrs?: Record<string, unknown>,
    error?: Error,
  ): void;

  /**
   * Start a timed operation.
   *
   * @param operation - The operation name (use LogOperation enum)
   * @param attrs - Initial attributes
   * @returns Timed operation handle
   */
  start(
    operation: LogOperation | string,
    attrs?: Record<string, unknown>,
  ): TimedOperation;
}

/**
 * Create a logger bound to a specific component.
 *
 * @param component - The component name (e.g., 'search-tool')
 * @returns Component-bound logger
 *
 * @example
 * ```typescript
 * const log = logger.forComponent('search-tool');
 *
 * // Simple log
 * log.info('vector_search_started', { query: 'how does array.map work' });
 *
 * // Timed operation
 * const op = log.start('vector_search', { query: 'how does array.map work' });
 * const results = await doSearch(query);
 * op.end({ results: results.length });
 * ```
 */
export async function forComponent(
  component: LogComponent,
): Promise<ComponentLogger> {
  const root = await getRootLogger();

  return {
    trace(operation: string, attrs?: Record<string, unknown>) {
      root.trace({ component, operation, ...attrs });
    },

    debug(operation: string, attrs?: Record<string, unknown>) {
      root.debug({ component, operation, ...attrs });
    },

    info(operation: string, attrs?: Record<string, unknown>) {
      root.info({ component, operation, ...attrs });
    },

    warn(operation: string, attrs?: Record<string, unknown>) {
      root.warn({ component, operation, ...attrs });
    },

    error(operation: string, attrs?: Record<string, unknown>, error?: Error) {
      if (error) {
        root.error({ component, operation, err: error, ...attrs });
      } else {
        root.error({ component, operation, ...attrs });
      }
    },

    start(operation: string, attrs?: Record<string, unknown>): TimedOperation {
      const startTime = performance.now();

      // Log start
      root.debug({ component, operation, status: "started", ...attrs });

      return {
        end(resultAttrs?: Record<string, unknown>) {
          const durationMs = Math.round(performance.now() - startTime);
          root.debug({
            component,
            operation,
            status: "completed",
            duration_ms: durationMs,
            ...attrs,
            ...resultAttrs,
          });
        },
      };
    },
  };
}

/**
 * Logger factory function.
 *
 * Use this to get component-bound loggers:
 * ```typescript
 * const log = await logger.forComponent('search-tool');
 * ```
 */
export const logger = {
  forComponent,
};

// Export for direct use in simple cases
export { getRootLogger };
