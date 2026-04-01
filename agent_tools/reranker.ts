/**
 * Reranking utility for document relevance scoring.
 * Uses Ollama's reranker API to score documents against a query.
 */

import { RERANKER_MODEL } from "../constants";

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
      console.warn(
        `Reranker API failed: ${response.statusText}. Returning all documents.`,
      );
      return documents.map((doc, i) => ({
        document: doc,
        score: 1.0,
        index: i,
      }));
    }

    const data = await response.json();
    if (!data.results || !Array.isArray(data.results)) {
      return documents.map((doc, i) => ({
        document: doc,
        score: 1.0,
        index: i,
      }));
    }

    return data.results.map(
      (result: { index: number; relevance_score: number }) => ({
        document: documents[result.index],
        score: result.relevance_score,
        index: result.index,
      }),
    );
  } catch (error) {
    console.warn(`Reranker error: ${error}. Returning all documents.`);
    return documents.map((doc, i) => ({ document: doc, score: 1.0, index: i }));
  }
}
