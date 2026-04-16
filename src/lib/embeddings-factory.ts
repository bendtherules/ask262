import type { Embeddings } from "@langchain/core/embeddings";
import { OllamaEmbeddings } from "@langchain/ollama";
import {
  EMBEDDING_PROVIDER,
  FIREWORKS_BASE_URL,
  FIREWORKS_EMBEDDING_MODEL,
  OLLAMA_EMBEDDING_MODEL,
} from "../constants.js";
import { FireworksEmbeddings } from "./fireworks-embeddings.js";

/**
 * Type for supported embedding providers.
 */
export type EmbeddingProvider = "ollama" | "fireworks";

/**
 * Create an embeddings instance based on the configured provider.
 *
 * @param provider - The embedding provider to use. Defaults to EMBEDDING_PROVIDER env var or "ollama"
 * @returns Embeddings instance (OllamaEmbeddings or FireworksEmbeddings)
 * @throws Error if provider is invalid or required credentials are missing
 *
 * @example
 * ```typescript
 * // Use default provider from env
 * const embeddings = createEmbeddings();
 *
 * // Explicitly use Fireworks
 * const embeddings = createEmbeddings("fireworks");
 *
 * // Explicitly use Ollama
 * const embeddings = createEmbeddings("ollama");
 * ```
 */
export function createEmbeddings(provider?: EmbeddingProvider): Embeddings {
  const selectedProvider =
    provider ?? (EMBEDDING_PROVIDER as EmbeddingProvider);

  switch (selectedProvider) {
    case "ollama": {
      console.error("[Embeddings] Using Ollama provider");
      return new OllamaEmbeddings({
        model: OLLAMA_EMBEDDING_MODEL,
        baseUrl: process.env.OLLAMA_HOST,
      });
    }

    case "fireworks": {
      const apiKey = process.env.FIREWORKS_API_KEY;
      if (!apiKey) {
        throw new Error("FIREWORKS_API_KEY environment variable is required");
      }
      console.error("[Embeddings] Using Fireworks provider");
      return new FireworksEmbeddings({
        apiKey,
        modelName: FIREWORKS_EMBEDDING_MODEL,
        baseUrl: FIREWORKS_BASE_URL,
      });
    }

    default: {
      throw new Error(
        `Unknown embedding provider: ${selectedProvider}. Use 'ollama' or 'fireworks'.`,
      );
    }
  }
}

/**
 * Get the currently configured embedding provider.
 *
 * @returns The active provider name
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  return (EMBEDDING_PROVIDER as EmbeddingProvider) ?? "ollama";
}
