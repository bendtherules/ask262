#!/usr/bin/env bun

/**
 * Ask262 MCP Server
 * Provides MCP-compatible tools for exploring the ECMAScript specification.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as lancedbSdk from "@lancedb/lancedb";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { askPromptMetadata, createAskPrompt } from "./agent-prompts/index.js";
import {
  createEvaluateInEngine262Tool,
  createGetSectionContentTool,
  createSearchSpecSectionsTool,
  type EvaluateToolInput,
  type EvaluateToolOutput,
  evaluateInputSchema,
  evaluateOutputSchema,
  evaluateToolMetadata,
  evaluateToolName,
  type GetSectionContentInput,
  type GetSectionContentOutput,
  getSectionInputSchema,
  getSectionOutputSchema,
  type SearchSpecInput,
  type SearchSpecOutput,
  searchSpecInputSchema,
  searchSpecOutputSchema,
  searchSpecToolMetadata,
  searchSpecToolName,
  sectionContentToolMetadata,
  sectionContentToolName,
} from "./agent-tools/index.js";
import { STORAGE_DIR as STORAGE_DIR_REL } from "./constants.js";
import { createEmbeddings } from "./lib/embeddings-factory.js";
import { LogOperation, logger } from "./lib/logger.js";
import { createProcessScopedTrace, withSpanContext } from "./lib/tracing.js";

// Resolve storage path relative to this script's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.resolve(__dirname, "..", STORAGE_DIR_REL);

// #region MCP Types

/**
 * MCP text content item for tool responses.
 */
export interface McpTextContent {
  type: "text";
  text: string;
}

// Base MCP output type with index signature for SDK compatibility
interface McpToolOutputBase {
  [key: string]: unknown;
  content: McpTextContent[];
}

// Evaluate tool MCP types
export type EvaluateToolMCPInput = EvaluateToolInput;

export interface EvaluateToolMCPOutput extends McpToolOutputBase {
  structuredContent: EvaluateToolOutput;
  isError?: boolean;
}

// Get section content tool MCP types
export type GetSectionContentMCPInput = GetSectionContentInput;

export interface GetSectionContentMCPOutput extends McpToolOutputBase {
  structuredContent: GetSectionContentOutput;
  isError?: boolean;
}

// Search spec tool MCP types
export type SearchSpecMCPInput = SearchSpecInput;

export interface SearchSpecMCPOutput extends McpToolOutputBase {
  structuredContent: SearchSpecOutput;
  isError?: boolean;
}

// #endregion

// Initialize embeddings based on ASK262_EMBEDDING_PROVIDER env var
const embeddings = createEmbeddings();

export async function main() {
  // Initialize stdio server logger
  const log = await logger.forComponent("stdio-server");

  // Create process-scoped trace ID for this session
  const sessionTraceId = createProcessScopedTrace();

  log.info(LogOperation.SERVER_STARTED, {
    transport: "stdio",
    trace_id: sessionTraceId,
  });

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
    async ({ query }: SearchSpecMCPInput): Promise<SearchSpecMCPOutput> => {
      return await withSpanContext(
        sessionTraceId,
        "vector_search",
        { tool: searchSpecToolName, query },
        async () => {
          const result = await searchSpecTool({ query });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          };
        },
      );
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
    async ({
      sectionIds,
      recursive,
    }: GetSectionContentMCPInput): Promise<GetSectionContentMCPOutput> => {
      return await withSpanContext(
        sessionTraceId,
        "section_fetch",
        { tool: sectionContentToolName, section_count: sectionIds.length },
        async () => {
          const result = await getSectionContentTool({ sectionIds, recursive });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          };
        },
      );
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
    async ({ code }: EvaluateToolMCPInput): Promise<EvaluateToolMCPOutput> => {
      return await withSpanContext(
        sessionTraceId,
        "code_execution",
        { tool: evaluateToolName, code_length: code.length },
        async () => {
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
    },
  );

  // Register prompt for tool orchestration guidance
  server.registerPrompt("ask", askPromptMetadata, async ({ question }) =>
    createAskPrompt(question),
  );

  // Use stdio transport for communication
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Ask262 MCP Server running on stdio");

  // Handle graceful shutdown
  const shutdown = (signal: string) => {
    log.info(LogOperation.SERVER_STOPPED, {
      signal,
      trace_id: sessionTraceId,
    });
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
