import fs from "node:fs";
import path from "node:path";
import { OllamaEmbedding } from "@llamaindex/ollama";
import * as cheerio from "cheerio";
import { glob } from "glob";
import {
  Document,
  SentenceSplitter,
  Settings,
  storageContextFromDefaults,
  VectorStoreIndex,
} from "llamaindex";
import { SPEC_DIR, STORAGE_DIR } from "../constants";

// Configure LlamaIndex to use local Ollama embeddings
// This creates vector embeddings for semantic search without external APIs
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text-v2-moe",
});

// Text chunking configuration to keep chunks small and focused
// Smaller chunks improve retrieval accuracy for technical documentation
const sentenceSplitter = new SentenceSplitter({
  chunkSize: 256,
  chunkOverlap: 20,
});

/**
 * Extracts ECMAScript specification sections from HTML files and converts them
 * to Documents for vector indexing. Each section (emu-clause) becomes a separate
 * document with metadata for tracking.
 *
 * Note: Only extracts text from the immediate section, excluding child sections
 * to prevent duplicate content and maintain granularity.
 *
 * @returns Array of Documents ready for indexing
 */
async function ingestSpec() {
  const htmlFiles = await glob(path.join(SPEC_DIR, "*.html"));
  const documents: Document[] = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(content);

    $("emu-clause").each((_i, elem) => {
      const id = $(elem).attr("id");
      const title = $(elem).find("h1").first().text().trim();
      // Only extract immediate text to avoid excessive chunking of child sections
      const text = $(elem)
        .clone()
        .children("emu-clause")
        .remove()
        .end()
        .text()
        .trim();

      if (id && title && text) {
        documents.push(
          new Document({
            text,
            metadata: {
              source: file,
              sectionId: id,
              sectionTitle: title,
              type: "specification",
            },
          }),
        );
      }
    });
  }
  return documents;
}

/**
 * Main execution pipeline:
 * 1. Ingest specification HTML files and convert to documents
 * 2. Split documents into smaller text chunks (nodes)
 * 3. Filter out oversized chunks that could exceed LLM context limits
 * 4. Build a vector index in batches to handle large document sets
 * 5. Persist the index to disk for later retrieval
 */
async function main() {
  console.log("Ingesting specification...");
  const specDocs = await ingestSpec();
  console.log(`Ingested ${specDocs.length} specification sections.`);

  console.log("Splitting documents into nodes...");
  const rawNodes = sentenceSplitter.getNodesFromDocuments(specDocs);
  console.log(`Total raw nodes generated: ${rawNodes.length}`);

  // Safety filter to ensure no node exceeds context limit
  const nodes = rawNodes.filter((node) => {
    const contentLen = node.getContent().length;
    if (contentLen > 2000) {
      console.warn(
        `Skipping node with length ${contentLen} from ${node.metadata.source || "unknown"}`,
      );
      return false;
    }
    return true;
  });
  console.log(`Total valid nodes for indexing: ${nodes.length}`);

  console.log("Creating storage context...");
  const storageContext = await storageContextFromDefaults({
    persistDir: STORAGE_DIR,
  });

  console.log("Building index (this might take a while with local Ollama)...");

  const BATCH_SIZE = 50;
  let index: VectorStoreIndex | null = null;

  // Try to load existing index if any
  try {
    index = await VectorStoreIndex.init({
      storageContext,
    });
    console.log("Existing index found, continuing ingestion...");
  } catch (_e) {
    console.log("No existing index found, starting fresh.");
  }

  // Process nodes in batches to avoid overwhelming the embedding service
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${i / BATCH_SIZE + 1} / ${Math.ceil(nodes.length / BATCH_SIZE)}...`,
    );

    if (!index) {
      index = await VectorStoreIndex.init({
        storageContext,
        nodes: batch,
      });
    } else {
      await index.insertNodes(batch);
    }
  }

  console.log(`Index built and persisted to ${STORAGE_DIR}`);
}

main().catch(console.error);
