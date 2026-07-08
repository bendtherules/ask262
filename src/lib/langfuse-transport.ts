import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

/** Trace name used for HTTP transport in Langfuse. */
export const TRACE_NAME_HTTP = "ask262-http";

/** Trace name used for stdio transport in Langfuse. */
export const TRACE_NAME_STDIO = "ask262-stdio";

/** Langfuse attribute key for setting the trace name on a span. */
export const LANGFUSE_TRACE_NAME_ATTR = "langfuse.trace.name";

/** Langfuse attribute key for observation input. */
export const LANGFUSE_OBSERVATION_INPUT_ATTR = "langfuse.observation.input";

/** Langfuse attribute key for observation output. */
export const LANGFUSE_OBSERVATION_OUTPUT_ATTR = "langfuse.observation.output";

/** Langfuse attribute key for trace-level input. */
export const LANGFUSE_TRACE_INPUT_ATTR = "langfuse.trace.input";

/** Langfuse attribute key for trace-level output. */
export const LANGFUSE_TRACE_OUTPUT_ATTR = "langfuse.trace.output";

let provider: NodeTracerProvider | null = null;

/**
 * Extract MCP tool call information from a JSON-RPC request body.
 * Used to populate trace-level input in Langfuse.
 */
export function extractMcpToolInfo(
  body: unknown,
): { method?: string; tool?: string; input?: unknown } {
  if (typeof body !== "object" || body === null) return {};
  const b = body as Record<string, unknown>;
  const rpcMethod = b.method as string | undefined;
  if (rpcMethod === "tools/call") {
    const params = b.params as Record<string, unknown> | undefined;
    return {
      method: rpcMethod,
      tool: params?.name as string | undefined,
      input: params?.arguments,
    };
  }
  return { method: rpcMethod };
}

/**
 * Initialize Langfuse OTel span processor.
 * Called once at server startup before any spans are created.
 */
export function initializeLangfuseTransport(): void {
  if (process.env.ASK262_LANGFUSE_ENABLED !== "true") return;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) {
    console.error(
      "[LANGFUSE] Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY, skipping",
    );
    return;
  }

  provider = new NodeTracerProvider({
    spanProcessors: [
      new LangfuseSpanProcessor({
        // Only export tool-call spans, skip health checks and protocol noise
        shouldExportSpan: (span) => {
          const mcpMethod = span.otelSpan.attributes["mcp_method"];
          if (mcpMethod === "tools/call") return true;
          return !mcpMethod;
        },
      }),
    ],
  });
  provider.register();
}
