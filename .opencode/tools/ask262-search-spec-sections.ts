/**
 * OpenCode custom tool: ask262_search_spec_sections
 * Searches the ECMAScript specification for relevant sections.
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { tool } from "@opencode-ai/plugin";
import {
  createSearchSpecSectionsTool,
  toolMetadata,
} from "../../src/agent-tools/searchSpecSections";

export default tool({
  description: toolMetadata.description,
  args: {
    query: tool.schema.string().describe(toolMetadata.args.query),
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
