/**
 * Search specification sections tool.
 * Performs semantic vector search to find relevant specification sections by query.
 */

import type { Table } from "@lancedb/lancedb";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { OllamaEmbeddings } from "@langchain/ollama";
import { z } from "zod";

/**
 * Tool metadata for reuse in OpenCode tools.
 */
export const toolMetadata = {
  description:
    "Vector search the ECMAScript specification for sections relevant to a query. " +
    "Returns JSON array with sectionId, sectionTitle, score, partIndex, totalParts, and content. " +
    "partIndex and totalParts indicate which chunk of a multi-part section this is " +
    "(0-indexed, partIndex+1/totalParts), null if single-part.",
  args: {
    query:
      "The search query to find relevant specification sections (e.g., 'how does array map work')",
  },
};

const searchSpecSchema = z.object({
  query: z.string().describe(toolMetadata.args.query),
});

/**
 * Creates the search spec sections tool.
 * Performs semantic vector search to find relevant spec sections.
 * @param table - LanceDB table containing spec vectors
 * @param embeddings - Ollama embeddings instance
 */
export function createSearchSpecSectionsTool(
  table: Table,
  embeddings: OllamaEmbeddings,
) {
  return new DynamicStructuredTool({
    name: "ask262_search_spec_sections",
    description: toolMetadata.description,
    schema: searchSpecSchema,
    func: async ({ query }) => {
      // Generate embedding for the query
      const queryVector = await embeddings.embedQuery(query);

      // Search using LanceDB directly, limit to top 5 results
      const results = await table.search(queryVector).limit(5).toArray();

      // Return documents with metadata as JSON
      const output = results.map((r: Record<string, unknown>) => ({
        sectionId: String(r.sectionid || "unknown"),
        sectionTitle: String(r.sectiontitle || "unknown"),
        score: Number(r._distance || 0),
        partIndex: r.partindex ?? null,
        totalParts: r.totalparts ?? null,
        content: String(r.text || ""),
      }));

      return JSON.stringify(output);
    },
  });
}
