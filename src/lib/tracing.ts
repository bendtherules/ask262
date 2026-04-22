/**
 * OpenTelemetry trace context management for Ask262 MCP server.
 *
 * Provides AsyncLocalStorage-based context propagation for nested operations,
 * enabling automatic parent-child span relationships without manual ID passing.
 *
 * @module lib/tracing
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Trace context stored in AsyncLocalStorage.
 */
interface TraceContext {
  /** The root trace identifier */
  traceId: string;
  /** The current span identifier */
  spanId: string;
  /** Parent span identifier (null for root spans) */
  parentSpanId: string | null;
  /** Span depth level (0 = root) */
  depth: number;
}

// AsyncLocalStorage for automatic context propagation
const traceStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Get the current trace context from AsyncLocalStorage.
 *
 * @returns Current trace context or undefined if not in a trace
 */
function getCurrentContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Generate a unique span ID.
 *
 * @returns Short span ID (16 hex chars)
 */
function generateSpanId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Generate a unique trace ID.
 *
 * @returns Full trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Create a new trace context for a root operation.
 *
 * @param traceId - Optional existing trace ID (e.g., from request header)
 * @returns New trace context
 *
 * @example
 * ```typescript
 * // Create new trace
 * const traceCtx = createTraceContext();
 *
 * // Or use existing trace ID from request
 * const traceCtx = createTraceContext(req.headers['x-request-id'] as string);
 * ```
 */
export function createTraceContext(traceId?: string): TraceContext {
  return {
    traceId: traceId ?? generateTraceId(),
    spanId: generateSpanId(),
    parentSpanId: null,
    depth: 0,
  };
}

/**
 * Execute a function within a trace context.
 *
 * This creates a new span and runs the function with that span as the active
 * context. Any nested operations will automatically inherit this context.
 *
 * @param operation - The operation name for the span
 * @param attributes - Initial span attributes
 * @param fn - The function to execute within the span
 * @param traceId - Optional trace ID to use (e.g., from request header)
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withSpan(
 *   'mcp_request',
 *   { tool: 'search-spec-sections' },
 *   async () => {
 *     // All code here has access to the span context
 *     return await handleRequest();
 *   }
 * );
 * ```
 */
export async function withSpan<T>(
  operation: string,
  attributes: Record<string, unknown> = {},
  fn: () => Promise<T>,
  traceId?: string,
): Promise<T> {
  const parentContext = getCurrentContext();
  const tracer = trace.getTracer("ask262");

  // Build span context
  const spanContext: TraceContext = parentContext
    ? {
        traceId: parentContext.traceId,
        spanId: generateSpanId(),
        parentSpanId: parentContext.spanId,
        depth: parentContext.depth + 1,
      }
    : createTraceContext(traceId);

  // Create OTel span for context tracking
  const span = tracer.startSpan(operation, {
    attributes: {
      ...attributes,
      "span.depth": spanContext.depth,
    },
  });

  // Store in AsyncLocalStorage for nested calls
  return traceStorage.run(spanContext, async () => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the current trace ID if in a trace context.
 *
 * @returns Trace ID or undefined
 */
export function getTraceId(): string | undefined {
  return getCurrentContext()?.traceId;
}

/**
 * Get the current span ID if in a trace context.
 *
 * @returns Span ID or undefined
 */
export function getSpanId(): string | undefined {
  return getCurrentContext()?.spanId;
}

/**
 * Get the parent span ID if in a trace context.
 *
 * @returns Parent span ID or undefined/null
 */
export function getParentSpanId(): string | null | undefined {
  return getCurrentContext()?.parentSpanId;
}

/**
 * Create a process-scoped trace context for stdio server.
 *
 * This creates a single trace ID that persists for the entire process lifetime,
 * suitable for stdio transport where there's no natural request boundary.
 *
 * @returns Process-scoped trace context
 *
 * @example
 * ```typescript
 * // At server startup
 * const sessionTraceId = createProcessScopedTrace();
 *
 * // For each message, use the same trace ID
 * await withSpanContext(sessionTraceId, 'mcp_request', async () => {
 *   // handle message
 * });
 * ```
 */
export function createProcessScopedTrace(): string {
  return generateTraceId();
}

/**
 * Execute a function with a specific trace context.
 *
 * Similar to withSpan but uses an existing trace ID, useful for stdio
 * where you want the same trace ID across multiple operations.
 *
 * @param traceId - The trace ID to use
 * @param operation - The operation name
 * @param attributes - Span attributes
 * @param fn - The function to execute
 * @returns Result of the function
 */
export async function withSpanContext<T>(
  traceId: string,
  operation: string,
  attributes: Record<string, unknown> = {},
  fn: () => Promise<T>,
): Promise<T> {
  // Check if we're already in a context
  const existingContext = getCurrentContext();

  if (existingContext && existingContext.traceId === traceId) {
    // Already in this trace, create child span
    return withSpan(operation, attributes, fn);
  }

  // Create new root span with this trace ID
  const spanContext: TraceContext = {
    traceId,
    spanId: generateSpanId(),
    parentSpanId: null,
    depth: 0,
  };

  const tracer = trace.getTracer("ask262");
  const span = tracer.startSpan(operation, {
    attributes: {
      ...attributes,
      "span.depth": 0,
    },
  });

  return traceStorage.run(spanContext, async () => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace context for HTTP server requests.
 *
 * Creates a new trace context for each request, optionally using
 * an existing trace ID from request headers.
 *
 * @param requestId - Optional request ID from headers
 * @returns New trace context for this request
 */
export function createHttpTraceContext(requestId?: string): TraceContext {
  return createTraceContext(requestId);
}

// Re-export for convenience
export { getCurrentContext as getTraceContext };
