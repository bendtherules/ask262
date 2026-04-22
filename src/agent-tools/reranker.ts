/**
 * Reranking utility for document relevance scoring.
 * Uses Ollama's reranker API to score documents against a query.
 */

import { RERANKER_MODEL } from "../constants.js";
import { LogOperation, logger } from "../lib/logger.js";
import { withSpan } from "../lib/tracing.js";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export interface RerankResult<T> {
  document: T;
  score: number;
  index: number;
}

/**
 * Rerank documents based on relevance to the query using Ollama's reranker.
 * @param query - The search query
 * @param documents - Array of documents to rerank
 * @returns Array of reranked documents with scores
 */
export async function rerankDocuments<T extends { pageContent: string }>(
  query: string,
  documents: T[],
): Promise<RerankResult<T>[]> {
  const log = await logger.forComponent("reranker");

  log.info(LogOperation.RERANKING_DOCUMENTS, {
    document_count: documents.length,
  });

  return await withSpan(
    LogOperation.RERANKING_DOCUMENTS,
    { document_count: documents.length },
    async () => {
      const op = log.start(LogOperation.RERANKING_DOCUMENTS, {
        document_count: documents.length,
        model: RERANKER_MODEL,
      });

      try {
        const response = await fetch(`${OLLAMA_HOST}/api/rerank`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: RERANKER_MODEL,
            query: query,
            documents: documents.map((d) => d.pageContent),
          }),
        });

        if (!response.ok) {
          log.warn("reranker_api_failed", {
            status: response.status,
            statusText: response.statusText,
          });
          op.end({
            status: "api_failed",
            fallback: true,
            document_count: documents.length,
          });
          return documents.map((doc, i) => ({
            document: doc,
            score: 1.0,
            index: i,
          }));
        }

        const data = await response.json();
        if (!data.results || !Array.isArray(data.results)) {
          log.warn("reranker_invalid_response", { response: data });
          op.end({
            status: "invalid_response",
            fallback: true,
            document_count: documents.length,
          });
          return documents.map((doc, i) => ({
            document: doc,
            score: 1.0,
            index: i,
          }));
        }

        // op.end logs the final success with all metrics
        op.end({
          status: "success",
          results_count: data.results.length,
        });

        return data.results.map(
          (result: { index: number; relevance_score: number }) => ({
            document: documents[result.index],
            score: result.relevance_score,
            index: result.index,
          }),
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.warn("reranker_error", { error: err.message });
        op.end({
          status: "error",
          error: err.message,
          fallback: true,
        });
        return documents.map((doc, i) => ({
          document: doc,
          score: 1.0,
          index: i,
        }));
      }
    },
  );
}
