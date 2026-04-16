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
import { z } from "zod";
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
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ code }: EvaluateToolMCPInput): Promise<EvaluateToolMCPOutput> => {
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
            text: `I'll help you explore this using the ECMAScript specification. Let me orchestrate the ask262 tools to find accurate information.

Available tools:
- ask262_search_spec_sections: Vector search to find relevant spec section ids
- ask262_get_section_content: Retrieve full text from a spec section id  
- ask262_evaluate_in_engine262: Execute pure JS and capture which spec section ids are hit. Has 1-second timeout for safety.

Based on your question: "${question}"

I'll use one of these orchestration patterns:

PATTERN 1 - For "What happens when I run this code?" questions:
   - Use ask262Debug.startImportant() and ask262Debug.stopImportant() in the code to mark only important sections.
   - STEP 1: ask262_evaluate_in_engine262(code: markedCode)
   - STEP 2: ask262_get_section_content(sectionId: importantSections[0], recursive: true)
   - Explain which spec sections were hit and why

PATTERN 2 - For "How does X work?" questions (e.g., "${question}"):
   - Flow A: Generate a specific code example and follow Pattern 1
   - Flow B: If no code example possible, search broadly:
     * STEP 1: ask262_search_spec_sections(query: relevant keywords from "${question}")
     * STEP 2: ask262_get_section_content(sectionId: foundSectionId, recursive: true)

I prefer Pattern 1 when possible as it provides exact spec sections through execution.

Key principles:
- Ignore internal knowledge about Javascript/ECMAScript - rely only on spec sections from tools
- Reference specific spec sections by section id (sec-array.prototype.map) or number/name (e.g., "23.1.3.21 Array.prototype.map")
- If I can't generate a relevant code example, I'll ask you to provide one`,
          },
        },
      ],
    }),
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
