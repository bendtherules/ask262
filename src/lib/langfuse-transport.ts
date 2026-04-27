import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

let provider: NodeTracerProvider | null = null;

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
        // Export all spans, not just LLM-relevant ones
        shouldExportSpan: () => true,
      }),
    ],
  });
  provider.register();
}
