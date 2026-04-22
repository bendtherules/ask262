#!/usr/bin/env bun

/**
 * Ask262 MCP HTTP Server (Non-streaming)
 * Provides HTTP-based MCP with normal JSON responses (no SSE).
 * Uses Hono framework for clean routing and middleware.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import * as lancedbSdk from "@lancedb/lancedb";
import { mountInspector } from "@mcp-use/inspector";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  createEvaluateInEngine262Tool,
  createGetSectionContentTool,
  createSearchSpecSectionsTool,
  evaluateInputSchema,
  evaluateOutputSchema,
  evaluateToolMetadata,
  evaluateToolName,
  getSectionInputSchema,
  getSectionOutputSchema,
  searchSpecInputSchema,
  searchSpecOutputSchema,
  searchSpecToolMetadata,
  searchSpecToolName,
  sectionContentToolMetadata,
  sectionContentToolName,
} from "./agent-tools/index.js";
import { DEFAULT_PORT, STORAGE_DIR as STORAGE_DIR_REL } from "./constants.js";
import { createEmbeddings } from "./lib/embeddings-factory.js";
import { LogOperation, logger } from "./lib/logger.js";
import { withSpan } from "./lib/tracing.js";

// Resolve storage path relative to this script's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.resolve(__dirname, "..", STORAGE_DIR_REL);

// Initialize embeddings based on ASK262_EMBEDDING_PROVIDER env var
const embeddings = createEmbeddings();

// Server port (uses env var or default from constants)
const PORT = Number(process.env.ASK262_PORT) || DEFAULT_PORT;

/**
 * Factory function to create a fresh MCP server instance.
 * Each HTTP request gets its own isolated server (stateless mode).
 */
async function createMcpServer() {
  // Connect to LanceDB
  const db = await lancedbSdk.connect(STORAGE_DIR);
  const table = await db.openTable("spec_vectors");

  // Create tool instances
  const searchSpecTool = createSearchSpecSectionsTool(table, embeddings);
  const getSectionContentTool = createGetSectionContentTool(table);
  const evaluateTool = createEvaluateInEngine262Tool();

  // Create MCP server
  const server = new McpServer(
    {
      name: "ask262-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
      },
    },
  );

  // Register search spec tool
  server.registerTool(
    searchSpecToolName,
    {
      description: searchSpecToolMetadata.description,
      inputSchema: searchSpecInputSchema,
      outputSchema: searchSpecOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }) => {
      const result = await searchSpecTool({ query });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      };
    },
  );

  // Register get section content tool
  server.registerTool(
    sectionContentToolName,
    {
      description: sectionContentToolMetadata.description,
      inputSchema: getSectionInputSchema,
      outputSchema: getSectionOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sectionIds, recursive }) => {
      const result = await getSectionContentTool({ sectionIds, recursive });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      };
    },
  );

  // Register evaluate in engine262 tool
  server.registerTool(
    evaluateToolName,
    {
      description: evaluateToolMetadata.description,
      inputSchema: evaluateInputSchema,
      outputSchema: evaluateOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ code }) => {
      const result = await evaluateTool({ code });
      const isError = result.error !== undefined;
      const text = isError ? result.error : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
        structuredContent: result,
        isError,
      };
    },
  );

  // Register prompt for tool orchestration guidance
  server.registerPrompt(
    "ask",
    {
      description:
        "Explains JavaScript internals from the ECMAScript specification.",
      argsSchema: {
        question: z.string().describe("Question"),
      },
    },
    async ({ question }) => ({
      description: "Ask262 orchestration guide",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: question,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `I'll help you understand this from the ECMAScript specification using ask262 tools.

Available tools:
- ask262_search_spec_sections: Vector search to find relevant spec section ids
- ask262_get_section_content: Retrieve full text from a spec section id  
- ask262_evaluate_in_engine262: Execute pure JS and capture which spec section ids are hit. Has 1-second timeout for safety.

I'll use one of these orchestration patterns:

PATTERN 1 - For "What happens when I run this code?" questions:
   - Use ask262Debug.startImportant() and ask262Debug.stopImportant() in the code to mark only important sections.
   - STEP 1: ask262_evaluate_in_engine262(code: markedCode)
   - STEP 2: ask262_get_section_content(sectionIds: ["sec-1", "sec-2"], recursive: true)
   - Explain which spec sections were hit and why

PATTERN 2 - For "How does X work?" questions:
   - Flow A: Generate a specific code example and follow Pattern 1
   - Flow B: If no code example possible, search broadly:
     * STEP 1: ask262_search_spec_sections(query: "<relevant keywords>")
     * STEP 2: ask262_get_section_content(sectionIds: ["sec-1", "sec-2"], recursive: true)

I prefer Pattern 1 when possible as it provides exact spec sections through execution.

Example - How inserting to array works?
- Maps to Pattern 2, Flow A:
- I'll generate this code: 
   let arr = [];
   ask262Debug.startImportant();
   arr.push(1);
   ask262Debug.stopImportant();
   console.log(arr);
   console.log(arr.length);
- I'll run it through ask262_evaluate_in_engine262 to find important sections
- I'll get content for some of those sections with ask262_get_section_content
- I'll explain which sections were hit and how they relate to Array.prototype.push and length property

Key principles:
- Ignore internal knowledge about Javascript/ECMAScript - rely only on spec sections from tools
- Reference specific spec sections either by section id (sec-array.prototype.map) or number+name (e.g., "23.1.3.21 Array.prototype.map")
- If I can't generate a relevant code example, I'll ask you to provide one`,
          },
        },
      ],
    }),
  );

  return server;
}

export async function main() {
  // Initialize HTTP server logger
  const log = await logger.forComponent("http-server");

  // Create Hono app
  const app = new Hono();

  // Enable CORS for all origins
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "HEAD", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  );

  // Health check endpoint
  app.get("/health", (c) => c.json({ status: "ok" }));

  // MCP HEAD handler - runs before the main handler
  app.use("/mcp", async (c, next) => {
    if (c.req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "mcp-protocol-version": "2025-03-26",
        },
      });
    }
    await next();
  });

  // MCP endpoint - handles GET and POST (HEAD is handled by middleware above)
  // Must be defined BEFORE inspector (which mounts at /) for proper route matching
  app.on(["GET", "POST"], "/mcp", async (c) => {
    // Get client IP from headers or connection
    const clientIp =
      c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";

    // Get trace ID from request header or create new
    const traceId = c.req.header("x-request-id") || undefined;

    // Get parsed body from Hono (automatic JSON parsing)
    let parsedBody: unknown;
    if (c.req.method === "POST") {
      try {
        parsedBody = await c.req.json();
      } catch {
        // Invalid JSON - let SDK handle the error
        parsedBody = await c.req.text();
      }
    }

    // Handle request within trace context (passing trace ID from header if available)
    return await withSpan(
      LogOperation.HANDLING_MCP_HTTP_REQUEST,
      { method: c.req.method, client_ip: clientIp },
      async () => {
        const op = log.start(LogOperation.HANDLING_MCP_HTTP_REQUEST, {
          method: c.req.method,
          client_ip: clientIp,
        });

        try {
          // Create fresh server and transport for each request (stateless mode)
          const server = await createMcpServer();
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // Stateless mode
            enableJsonResponse: true, // Use JSON responses instead of SSE streaming
          });
          await server.connect(transport);

          // Use Web Standard handleRequest method
          // Hono's c.req.raw is a Web Standard Request
          const response = await transport.handleRequest(c.req.raw, {
            parsedBody,
          });

          op.end({ status: "success" });

          // Return the Web Standard Response directly
          return response;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(
            LogOperation.HANDLING_MCP_HTTP_REQUEST,
            { status: "error" },
            error,
          );
          op.end({ status: "error", error: error.message });
          throw err;
        }
      },
      traceId,
    );
  });

  // MCP Inspector at root path - auto-connects to /mcp
  // Mounted AFTER /mcp so specific routes take precedence
  const mcpPublicUrl =
    process.env.COOLIFY_URL ||
    process.env.MCP_PUBLIC_URL ||
    `http://localhost:${PORT}`;
  mountInspector(app, {
    autoConnectUrl: `${mcpPublicUrl}/mcp`,
    devMode: process.env.NODE_ENV !== "production",
  });

  // Start the server
  log.info(LogOperation.SERVER_STARTED, {
    port: PORT,
    transport: "http",
    mode: "stateless-json",
    endpoints: ["/mcp", "/health"],
  });

  // Minimal console output for startup visibility
  console.error(`Ask262 MCP HTTP Server running on http://0.0.0.0:${PORT}`);
  console.error(`MCP endpoint: POST http://0.0.0.0:${PORT}/mcp`);
  console.error(`Mode: Stateless JSON (non-streaming)`);

  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: "0.0.0.0", // Bind to all interfaces for container/Docker compatibility
  });

  // Handle graceful shutdown
  const shutdown = (signal: string) => {
    log.info(LogOperation.SERVER_STOPPED, { signal });
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
