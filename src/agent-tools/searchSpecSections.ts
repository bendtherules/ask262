/**
 * Search specification sections tool.
 * Performs semantic vector search to find relevant specification sections by query.
 */

import type { Table } from "@lancedb/lancedb";
import type { Embeddings } from "@langchain/core/embeddings";
import { z } from "zod";
import { LogOperation, logger } from "../lib/logger.js";
import { withSpan } from "../lib/tracing.js";

// #region Zod schemas (not exported)

const searchSpecResultSchema = z.object({
  sectionId: z.string(),
  sectionTitle: z.string(),
  vectorDistance: z
    .number()
    .describe("Vector distance from query (lower = more similar)"),
  partIndex: z.number().nullable(),
  totalParts: z.number().nullable(),
});

const searchSpecOutputSchema = z.object({
  results: z.array(searchSpecResultSchema),
});

// #endregion

// #region Exported Zod schemas

export const toolMetadata = {
  description:
    "Vector search the ECMAScript specification for sections relevant to a query. " +
    "Returns an array of section references (sectionId, sectionTitle, vectorDistance, partIndex, totalParts). " +
    "Use ask262_get_section_content to retrieve the actual content for a section. " +
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
    const log = await logger.forComponent("search-tool");

    log.info(LogOperation.SEARCH_SPEC_SECTIONS, { query });

    return await withSpan(
      LogOperation.SEARCHING_SPEC_SECTIONS,
      { query },
      async () => {
        const op = log.start(LogOperation.SEARCHING_SPEC_SECTIONS, { query });

        const SEARCH_LIMIT = 5;

        try {
          // Generate embedding for the query (timed operation)
          const embedOp = log.start(LogOperation.GENERATING_EMBEDDING, {
            query,
          });
          const queryVector = await embeddings.embedQuery(query);
          embedOp.end();

          // Search using LanceDB directly, limit to top results (timed operation)
          const searchOp = log.start(LogOperation.QUERYING_LANCEDB, {
            query,
            limit: SEARCH_LIMIT,
          });
          const results = await table
            .search(queryVector)
            .limit(SEARCH_LIMIT)
            .toArray();
          searchOp.end({ results_found: results.length });

          // Return documents with metadata as structured objects
          const output: SearchSpecResult[] = results.map(
            (r: Record<string, unknown>) => ({
              sectionId: String(r.sectionid || "unknown"),
              sectionTitle: String(r.sectiontitle || "unknown"),
              vectorDistance: Number(r._distance || 0),
              partIndex: (r.partindex as number | undefined) ?? null,
              totalParts: (r.totalparts as number | undefined) ?? null,
            }),
          );

          op.end({
            results: output.length,
            section_ids: output.map((r) => r.sectionId),
          });

          return { results: output };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(LogOperation.SEARCHING_SPEC_SECTIONS, { query }, error);
          throw err;
        }
      },
    );
  };
}
