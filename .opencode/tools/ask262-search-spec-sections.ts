/**
 * OpenCode custom tool: ask262_search_spec_sections
 * Searches the ECMAScript specification for relevant sections.
 */

import { tool } from "@opencode-ai/plugin";
import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createSearchSpecSectionsTool } from "../../src/agent-tools";

export default tool({
  description:
    "Searches the ECMAScript specification for sections relevant to a query. " +
    "Returns JSON array with sectionId, sectionTitle, score, partIndex, totalParts, and content. " +
    "Use this when you need to find spec sections related to a JavaScript topic or question.",
  args: {
    query: tool.schema
      .string()
      .describe(
        "The search query to find relevant specification sections (e.g., 'how does array map work')",
      ),
  },
  async execute(args, context) {
    const { query } = args;
    const { worktree } = context;

    // Initialize embeddings
    const embeddings = new OllamaEmbeddings({
      model: "qwen3-embedding:0.6b",
    });

    // Connect to LanceDB
    const storageDir = `${worktree}/storage`;
    const db = await lancedbSdk.connect(storageDir);
    const table = await db.openTable("spec_vectors");

    // Create and execute tool
    const searchTool = createSearchSpecSectionsTool(table, embeddings);
    const result = await searchTool.func({ query });

    return result;
  },
});
