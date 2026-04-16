/**
 * Search specification sections tool.
 * Performs semantic vector search to find relevant specification sections by query.
 */

import type { Table } from "@lancedb/lancedb";
import type { Embeddings } from "@langchain/core/embeddings";
import { z } from "zod";

// #region Zod schemas (not exported)

const searchSpecResultSchema = z.object({
  sectionId: z.string(),
  sectionTitle: z.string(),
  score: z.number(),
  partIndex: z.number().nullable(),
  totalParts: z.number().nullable(),
  content: z.string(),
});

const searchSpecOutputSchema = z.object({
  results: z.array(searchSpecResultSchema),
});

// #endregion

// #region Exported Zod schemas

export const toolMetadata = {
  description:
    "Vector search the ECMAScript specification for sections relevant to a query. " +
    "Returns an array of sections with sectionId, sectionTitle, score, partIndex, totalParts, and content. " +
    "partIndex and totalParts indicate which chunk of a multi-part section this is " +
    "(0-indexed, partIndex+1/totalParts), null if single-part.",
  args: {
    query:
      "The search query to find relevant specification sections (e.g., 'how does array map work')",
  },
};

export const inputSchema = z.object({
  query: z.string().describe(toolMetadata.args.query),
});

export const outputSchema = searchSpecOutputSchema;

export const toolName = "ask262_search_spec_sections";

// #endregion

// #region TypeScript types (inferred from Zod schemas)

export type SearchSpecResult = z.infer<typeof searchSpecResultSchema>;

export type SearchSpecOutput = z.infer<typeof searchSpecOutputSchema>;

export type SearchSpecInput = z.infer<typeof inputSchema>;

// #endregion

/**
 * Creates the search spec sections tool function.
 * Performs semantic vector search to find relevant spec sections.
 * @param table - LanceDB table containing spec vectors
 * @param embeddings - Embeddings instance (Ollama or Fireworks)
 * @returns Function that performs the search and returns structured output
 */
export function createSearchSpecSectionsTool(
  table: Table,
  embeddings: Embeddings,
) {
  return async ({ query }: SearchSpecInput): Promise<SearchSpecOutput> => {
    // Generate embedding for the query
    const queryVector = await embeddings.embedQuery(query);

    // Search using LanceDB directly, limit to top 5 results
    const results = await table.search(queryVector).limit(5).toArray();

    // Return documents with metadata as structured objects
    const output: SearchSpecResult[] = results.map(
      (r: Record<string, unknown>) => ({
        sectionId: String(r.sectionid || "unknown"),
        sectionTitle: String(r.sectiontitle || "unknown"),
        score: Number(r._distance || 0),
        partIndex: (r.partindex as number | undefined) ?? null,
        totalParts: (r.totalparts as number | undefined) ?? null,
        content: String(r.text || ""),
      }),
    );

    return { results: output };
  };
}
