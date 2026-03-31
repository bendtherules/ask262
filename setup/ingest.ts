import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
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

// Text chunking configuration for larger chunks with more context preservation
// Larger chunks reduce total number of nodes while still fitting within
// the embedding model's 8192 token limit (~2048 chars ≈ 512 tokens)
const sentenceSplitter = new SentenceSplitter({
  chunkSize: 2048,
  chunkOverlap: 50,
});

/**
 * Prompts the user for confirmation via stdin.
 * @param question - The question to display to the user
 * @returns Promise that resolves to true if user confirms (yes/y), false otherwise
 */
function askUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "yes" || normalized === "y");
    });
  });
}

// Tags to extract from large sections for finer-grained chunking
// Extend this array to add more tag types for breakdown
const BREAKDOWN_TAGS = ["emu-table", "emu-grammar"] as const;
const LARGE_DOC_THRESHOLD = 5000;

/**
 * Extracts ECMAScript specification sections from HTML files and converts them
 * to Documents for vector indexing. Each section (emu-clause) becomes a separate
 * document with metadata for tracking.
 *
 * For large sections (> 5000 chars), attempts to break them down by extracting
 * content from specific structural tags (emu-table, emu-grammar, etc.) to create
 * more focused chunks. Falls back to the full section text if no breakdown tags
 * are found.
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

      if (!id || !title || !text) {
        return;
      }

      // For large documents, attempt to break down by structural tags
      if (text.length > LARGE_DOC_THRESHOLD) {
        let subDocsCreated = false;
        const $section = $(elem).clone();
        $section.children("emu-clause").remove();

        // Extract content from each breakdown tag type
        for (const tagName of BREAKDOWN_TAGS) {
          let partCounter = 1;
          $section.find(tagName).each((_, subElem) => {
            const subText = $(subElem).text().trim();
            const subId = `${id}-${tagName}-part-${partCounter}`;
            partCounter++;

            if (subText) {
              documents.push(
                new Document({
                  text: subText,
                  metadata: {
                    source: file,
                    sectionId: subId,
                    sectionTitle: `${title} [${tagName}]`,
                    type: "specification",
                    parentSectionId: id,
                    breakdownTag: tagName,
                  },
                }),
              );
              subDocsCreated = true;
            }
          });
        }

        // Extract remaining content (text outside breakdown tags)
        const $remaining = $section.clone();
        for (const tagName of BREAKDOWN_TAGS) {
          $remaining.find(tagName).remove();
        }
        const remainingText = $remaining.text().trim();

        if (remainingText) {
          documents.push(
            new Document({
              text: remainingText,
              metadata: {
                source: file,
                sectionId: `${id}-prose-part-1`,
                sectionTitle: `${title} [prose]`,
                type: "specification",
                parentSectionId: id,
                breakdownTag: "prose",
              },
            }),
          );
        }

        // Skip adding the full section since we've broken it into parts
        if (subDocsCreated || remainingText) {
          return;
        }
        // Otherwise, fall through to add the full section document
      }

      // Add the full section document (for smaller sections or when no breakdown happened)
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

  // Debug: Log largest documents (over 2000 chars) to diagnose oversized nodes
  const largeDocs = specDocs
    .map((doc, i) => ({
      index: i,
      length: doc.text.length,
      sectionId: doc.metadata.sectionId,
    }))
    .filter((doc) => doc.length > 2000)
    .sort((a, b) => b.length - a.length)
    .slice(0, 50);

  if (largeDocs.length > 0) {
    console.log("\nDebug: Largest documents (> 2000 chars):");
    largeDocs.forEach((doc) => {
      console.log(
        `  Doc ${doc.index}: ${doc.length} chars, section: ${doc.sectionId}`,
      );
    });
    const remaining =
      specDocs.filter((doc) => doc.text.length > 2000).length -
      largeDocs.length;
    if (remaining > 0) {
      console.log(`  ... and ${remaining} more large documents`);
    }
  } else {
    console.log("\nDebug: No documents over 2000 chars found");
  }

  const rawNodes = sentenceSplitter.getNodesFromDocuments(specDocs);
  console.log(`Total raw nodes generated: ${rawNodes.length}`);

  // Debug: Log node size distribution
  const nodeSizes = rawNodes.map((n) => n.getContent().length);
  const maxNodeSize = Math.max(...nodeSizes);
  const avgNodeSize = nodeSizes.reduce((a, b) => a + b, 0) / nodeSizes.length;
  console.log(
    `\nDebug: Node size stats - Max: ${maxNodeSize}, Avg: ${Math.round(avgNodeSize)}`,
  );

  // Safety filter to ensure no node exceeds context limit
  // Filter threshold set to chunkSize + buffer for metadata overhead
  const MAX_NODE_LENGTH = 2500;
  let skippedCount = 0;
  const nodes = rawNodes.filter((node) => {
    const contentLen = node.getContent().length;
    if (contentLen > MAX_NODE_LENGTH) {
      skippedCount++;
      if (skippedCount <= 3) {
        console.warn(
          `Skipping node with length ${contentLen} from ${node.metadata.source || "unknown"} (section: ${node.metadata.sectionId})`,
        );
      }
      return false;
    }
    return true;
  });

  if (skippedCount > 3) {
    console.warn(`  ... and ${skippedCount - 3} more nodes skipped`);
  }
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
    console.log("Existing index found.");
    const shouldOverwrite = await askUser(
      "Do you want to overwrite the existing vector store?",
    );
    if (!shouldOverwrite) {
      console.log("Ingest cancelled by user.");
      process.exit(0);
    }
    console.log("Overwriting existing index...");
    // Reset index to null so we create a fresh one
    index = null;
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
