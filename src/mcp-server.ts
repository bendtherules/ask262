/**
 * Ask262 MCP Server
 * Provides MCP-compatible tools for exploring the ECMAScript specification.
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { STORAGE_DIR } from "./constants.js";

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

// Initialize embeddings
const embeddings = new OllamaEmbeddings({
  model: "qwen3-embedding:0.6b",
});

async function main() {
  // Connect to LanceDB
  const db = await lancedbSdk.connect(STORAGE_DIR);
  const table = await db.openTable("spec_vectors");

  // Create tool instances
  const searchSpecTool = createSearchSpecSectionsTool(table, embeddings);
  const getSectionContentTool = createGetSectionContentTool(table);
  const evaluateTool = createEvaluateInEngine262Tool();

  // Create MCP server
  const server = new McpServer({
    name: "ask262-server",
    version: "1.0.0",
  });

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
    async ({
      sectionId,
      recursive,
    }: GetSectionContentMCPInput): Promise<GetSectionContentMCPOutput> => {
      const result = await getSectionContentTool({ sectionId, recursive });
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
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ code }: EvaluateToolMCPInput): Promise<EvaluateToolMCPOutput> => {
      const result = await evaluateTool({ code });
      const isError = "error" in result;
      const text = isError ? result.error : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
        structuredContent: result,
        isError,
      };
    },
  );

  // Use stdio transport for communication
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Ask262 MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
