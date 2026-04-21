import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { LogOperation, logger } from "./logger.js";

/**
 * Interface for FireworksEmbeddings parameters.
 */
export interface FireworksEmbeddingsParams extends EmbeddingsParams {
  /**
   * API key for Fireworks.ai
   * Can also be set via FIREWORKS_API_KEY env var
   */
  apiKey?: string;

  /**
   * Model name to use
   * @default "fireworks/qwen3-embedding-8b"
   */
  modelName?: string;

  /**
   * Base URL for Fireworks API
   * @default "https://api.fireworks.ai/inference/v1"
   */
  baseUrl?: string;

  /**
   * Maximum number of documents to embed in a single request
   * @default 100
   */
  batchSize?: number;

  /**
   * Maximum retries for rate limit errors
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial wait time in ms for rate limit retries (doubles each retry)
   * @default 1000
   */
  initialRetryDelayMs?: number;
}

/**
 * Fireworks.ai embeddings implementation for LangChain.
 * Uses the qwen3-embedding-8b model via Fireworks inference API.
 *
 * @example
 * ```typescript
 * const embeddings = new FireworksEmbeddings({
 *   apiKey: process.env.FIREWORKS_API_KEY,
 *   modelName: "fireworks/qwen3-embedding-8b",
 * });
 *
 * const vectors = await embeddings.embedDocuments(["hello", "world"]);
 * ```
 */
export class FireworksEmbeddings extends Embeddings {
  private apiKey: string;
  private modelName: string;
  private baseUrl: string;
  private batchSize: number;
  private maxRetries: number;
  private initialRetryDelayMs: number;

  constructor(params?: FireworksEmbeddingsParams) {
    super(params ?? {});

    this.apiKey = params?.apiKey ?? process.env.FIREWORKS_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "Fireworks API key is required. Set FIREWORKS_API_KEY env var or pass apiKey parameter.",
      );
    }

    this.modelName = params?.modelName ?? "fireworks/qwen3-embedding-8b";
    this.baseUrl = params?.baseUrl ?? "https://api.fireworks.ai/inference/v1";
    this.batchSize = params?.batchSize ?? 100;
    this.maxRetries = params?.maxRetries ?? 3;
    this.initialRetryDelayMs = params?.initialRetryDelayMs ?? 1000;
  }

  /**
   * Embed a single document (query).
   * Uses the embeddings endpoint optimized for search queries.
   */
  async embedQuery(document: string): Promise<number[]> {
    const vectors = await this.embedDocuments([document]);
    return vectors[0];
  }

  /**
   * Embed multiple documents in batches with rate limit handling.
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) {
      return [];
    }

    const log = await logger.forComponent("fireworks-embeddings");
    const op = log.start(LogOperation.EMBEDDING_DOCUMENTS, {
      total_documents: documents.length,
      batch_size: this.batchSize,
      model: this.modelName,
    });

    const allEmbeddings: number[][] = [];
    const totalBatches = Math.ceil(documents.length / this.batchSize);

    // Process in batches
    for (let i = 0; i < documents.length; i += this.batchSize) {
      const batchNum = Math.floor(i / this.batchSize) + 1;
      const batch = documents.slice(i, i + this.batchSize);

      log.debug(LogOperation.PROCESSING_EMBEDDING_BATCH, {
        batch_num: batchNum,
        total_batches: totalBatches,
        batch_size: batch.length,
      });

      const batchEmbeddings = await this.embedBatchWithRetry(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    op.end({
      total_documents: documents.length,
      batches: totalBatches,
      embeddings_generated: allEmbeddings.length,
    });

    return allEmbeddings;
  }

  /**
   * Embed a single batch with retry logic for rate limits.
   */
  private async embedBatchWithRetry(
    documents: string[],
    attempt = 1,
  ): Promise<number[][]> {
    const log = await logger.forComponent("fireworks-embeddings");

    try {
      log.debug(LogOperation.PROCESSING_EMBEDDING_BATCH, {
        batch_size: documents.length,
        attempt,
        model: this.modelName,
      });

      return await this.embedBatch(documents);
    } catch (error) {
      // Check if it's a rate limit error (429)
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate limit"));

      if (isRateLimit && attempt < this.maxRetries) {
        const delay = this.initialRetryDelayMs * 2 ** (attempt - 1);
        log.warn(LogOperation.RETRYING_RATE_LIMIT, {
          attempt,
          max_retries: this.maxRetries,
          delay_ms: delay,
          batch_size: documents.length,
        });
        await sleep(delay);
        return this.embedBatchWithRetry(documents, attempt + 1);
      }

      log.error(
        LogOperation.PROCESSING_EMBEDDING_BATCH,
        { batch_size: documents.length, attempt, is_rate_limit: isRateLimit },
        error instanceof Error ? error : new Error(String(error)),
      );

      // Fail fast for other errors or if retries exhausted
      throw error;
    }
  }

  /**
   * Make the actual API call to Fireworks for embeddings.
   */
  private async embedBatch(documents: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: this.modelName,
        input: documents,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Fireworks API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as FireworksEmbeddingResponse;

    // Extract embeddings from response
    // Fireworks returns embeddings in the same order as input
    const embeddings = data.data.map((item) => item.embedding);

    return embeddings;
  }
}

/**
 * Sleep utility for rate limit retries.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fireworks API response structure for embeddings.
 */
interface FireworksEmbeddingResponse {
  object: "list";
  data: Array<{
    object: "embedding";
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
