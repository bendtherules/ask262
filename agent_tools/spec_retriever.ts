/**
 * Specification retriever tool.
 * Queries the language specification for text content about specific sections or topics.
 */

import type { Table } from "@lancedb/lancedb";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { OllamaEmbeddings } from "@langchain/ollama";
import { z } from "zod";
import { rerankDocuments } from "./reranker";

const specRetrieverSchema = z.object({
  query: z
    .string()
    .describe("The search query to find relevant specification sections"),
});

/**
 * Creates the spec retriever tool.
 * @param table - LanceDB table containing spec vectors
 * @param embeddings - Ollama embeddings instance
 */
export function createSpecRetrieverTool(
  table: Table,
  embeddings: OllamaEmbeddings,
) {
  return new DynamicStructuredTool({
    name: "spec_retriever",
    description:
      "Queries the language specification for text content about specific sections or topics. Fetches up to 10 initial matches and uses a reranker to dynamically select the most relevant 3-5 documents based on query relevance.",
    schema: specRetrieverSchema,
    func: async ({ query }) => {
      // Generate embedding for the query
      const queryVector = await embeddings.embedQuery(query);

      // Search using LanceDB directly
      const results = await table.search(queryVector).limit(10).toArray();

      // Create document objects with metadata
      const documents = results.map((r: Record<string, unknown>) => ({
        pageContent: String(r.text || ""),
        metadata: {
          source: r.source,
          sectionid: r.sectionid,
          sectiontitle: r.sectiontitle,
          type: r.type,
          parentsectionid: r.parentsectionid,
          childrensectionids: r.childrensectionids,
          partindex: r.partindex,
          totalparts: r.totalparts,
        },
      }));

      // Rerank documents
      const reranked = await rerankDocuments(query, documents);

      // Sort by score and filter to most relevant
      reranked.sort((a, b) => b.score - a.score);

      // Dynamic selection: take top documents with score > 0.5, or at least top 3
      const threshold = 0.5;
      const minDocs = 3;
      const maxDocs = 5;

      const selected = reranked.filter(
        (r, i) => i < minDocs || (i < maxDocs && r.score > threshold),
      );

      console.log(
        `[spec_retriever] Query: "${query.slice(0, 50)}..." - Fetched ${documents.length}, reranked to ${selected.length} (scores: ${selected.map((s) => s.score.toFixed(2)).join(", ")})`,
      );

      // Return documents with metadata
      return selected
        .map((r) => {
          const meta = r.document.metadata;
          const sectionId = meta?.sectionid || "unknown";
          const sectionTitle = meta?.sectiontitle || "unknown";
          const partInfo =
            meta?.partindex !== null && meta?.partindex !== undefined
              ? ` [part ${(meta.partindex as number) + 1}/${meta.totalparts}]`
              : "";
          return `--- Section: ${sectionId} | "${sectionTitle}"${partInfo} (score: ${r.score.toFixed(2)}) ---\n${r.document.pageContent}`;
        })
        .join("\n\n");
    },
  });
}
