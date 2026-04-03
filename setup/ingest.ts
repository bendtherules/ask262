import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import * as lancedbSdk from "@lancedb/lancedb";
import { Index } from "@lancedb/lancedb";
import { Document } from "@langchain/core/documents";
import { OllamaEmbeddings } from "@langchain/ollama";
import * as cheerio from "cheerio";
import { glob } from "glob";
import ora from "ora";
import { EMBEDDING_MODEL, SPEC_DIR, STORAGE_DIR } from "../constants";
import { HTMLTextSplitter } from "../textsplitters";

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
});

const htmlSplitter = new HTMLTextSplitter({
  chunkSize: 8192,
  maxChunkSize: 12288,
  chunkOverlap: 0,
  separators: [
    "emu-note",
    "emu-example",
    "emu-table",
    "td",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
  ],
  neverBreakWithin: ["emu-grammar", "emu-alg"],
});

const LARGE_DOC_THRESHOLD = htmlSplitter.chunkSize + 100;
const BATCH_SIZE = 100;

async function generateEmbeddingsWithProgress(
  documents: Document[],
): Promise<number[][]> {
  const total = documents.length;
  const vectors: number[][] = [];
  const spinner = ora({
    text: `Generating embeddings (0/${total})...`,
    discardStdin: false,
  }).start();

  let currentIndex = 0;
  try {
    for (let i = 0; i < total; i += BATCH_SIZE) {
      currentIndex = i;
      const batch = documents.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((doc) => doc.pageContent);

      // Update spinner before processing batch
      const currentDoc = batch[0];
      const progress = `${i + batch.length}/${total}`;
      const sectionId = currentDoc.metadata.sectionid || "unknown";
      const contentLength = currentDoc.pageContent.length;
      spinner.text = `Generating embeddings (${progress}): ${sectionId} (${contentLength} chars)`;

      const batchVectors = await embeddings.embedDocuments(batchTexts);
      vectors.push(...batchVectors);
    }
    spinner.succeed(`Generated ${vectors.length} embeddings`);
  } catch (error) {
    const failedDoc = documents[currentIndex];
    const failedSectionId = failedDoc?.metadata?.sectionid || "unknown";
    const failedSectionTitle = failedDoc?.metadata?.sectiontitle || "unknown";
    const failedContentLength = failedDoc?.pageContent?.length || 0;
    spinner.fail(`Failed to generate embeddings: ${error}`);
    console.error(
      `Debug: Failed on section ${failedSectionId} "${failedSectionTitle}" (${failedContentLength} chars)`,
    );
    throw error;
  }

  return vectors;
}

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

async function buildSpecDocuments(): Promise<Document[]> {
  const htmlFiles = await glob(path.join(SPEC_DIR, "*.html"));
  const documents: Document[] = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(`<body>${content}</body>`);

    // First pass: collect all sections and build hierarchy
    const sectionMap = new Map<
      string,
      {
        title: string;
        parentId: string | null;
        childrenIds: string[];
        html: string;
      }
    >();

    $("#spec-container emu-clause").each((_i, elem) => {
      const id = $(elem).attr("id");
      const title = $(elem).find("h1").first().text().trim();

      if (!id || !title) {
        return;
      }

      // Get parent section id
      const parentElem = $(elem).parent("emu-clause");
      const parentId =
        parentElem.length > 0 ? parentElem.attr("id") || null : null;

      sectionMap.set(id, {
        title,
        parentId,
        childrenIds: [],
        html: $(elem).html() || "",
      });
    });

    // Build children relationships
    for (const [id, section] of sectionMap) {
      if (section.parentId && sectionMap.has(section.parentId)) {
        const parent = sectionMap.get(section.parentId)!;
        parent.childrenIds.push(id);
      }
    }

    // Second pass: create documents with formatted text
    for (const [id, section] of sectionMap) {
      // Parse the stored HTML and replace direct children with placeholders
      const $section = cheerio.load(`<body>${section.html}</body>`).root();

      // Find direct children emu-clause elements only
      $section.children("emu-clause").each((_, childElem) => {
        const childId = $(childElem).attr("id");
        if (childId && sectionMap.has(childId)) {
          const child = sectionMap.get(childId)!;
          const placeholder = `[Subsection available: sectiontitle "${child.title}" at sectionid: \`${childId}\`]`;
          $(childElem).replaceWith(placeholder);
        } else {
          $(childElem).remove();
        }
      });

      // Remove any nested emu-clause elements that weren't direct children
      // (shouldn't happen with proper HTML structure, but just in case)
      $section.find("emu-clause").remove();

      // Skip sections that only have h1 left (no meaningful content)
      const hasOnlyH1 =
        $section.children().length === 1 &&
        $section.children("h1").length === 1;
      const textContent = $section.text().trim();
      const hasMinimalContent = textContent.length <= section.title.length + 10; // title + small buffer

      if (hasOnlyH1 || hasMinimalContent) {
        continue;
      }

      // Get HTML content with inline placeholders for splitting
      const sectionHtml = $section.html() || "";

      // Split HTML into normalized text chunks.
      const chunks = await htmlSplitter.splitText(sectionHtml);

      // First pass: collect all chunk data
      // Only mark chunks as "small" if the original section content was long enough
      // to reasonably split (more than 100 chars). This prevents false positives
      // when the entire section was just naturally brief.
      const chunkData = chunks.map((chunk, idx) => {
        return {
          index: idx,
          text: chunk,
          size: chunk.length,
          isSmall: chunk.length < 50 && textContent.length > 100,
        };
      });

      // Print warnings for small chunks
      const smallChunks = chunkData.filter((c) => c.isSmall);
      if (smallChunks.length > 0) {
        const cleanedHtml = sectionHtml.replace(/\s+/g, " ").trim();
        for (const chunk of smallChunks) {
          console.warn(
            `  ⚠️ WARNING: Chunk ${chunk.index + 1}/${chunks.length} for section ${id} is very small (${chunk.size} chars)`,
          );
          console.warn(`     Chunk content: "${chunk.text}"`);
          console.warn(
            `     Original text that was split (${sectionHtml.length} chars):`,
          );
          console.warn(
            `     "${cleanedHtml.slice(0, 500)}${cleanedHtml.length > 500 ? "... [truncated]" : ""}"`,
          );
        }
        // Print summary after all warnings
        const chunkSizes = chunkData
          .map((c) => `${c.index + 1}:${c.size}`)
          .join(", ");
        const totalChunkSize = chunkData.reduce((sum, c) => sum + c.size, 0);
        console.warn(
          `     All chunk sizes: [${chunkSizes}] (total: ${totalChunkSize} chars)`,
        );
      }

      // Print warnings for large sections wasn't split properly
      if (chunkData.length === 1 && chunkData[0].size > LARGE_DOC_THRESHOLD) {
        console.warn(
          `  🛑 Section ${id} (${section.title}) is large (${chunkData[0].size} chars) but was NOT split (1 chunk)`,
        );
      }

      // Create documents
      for (const chunk of chunkData) {
        documents.push(
          new Document({
            pageContent: chunk.text,
            metadata: {
              source: path.basename(file),
              sectionid: id,
              sectiontitle: section.title,
              type: "specification",
              parentsectionid: section.parentId,
              childrensectionids: section.childrenIds,
              partIndex: chunk.index,
              totalParts: chunkData.length,
            },
          }),
        );
      }
    }
  }

  return documents;
}

async function main() {
  console.log("Building specification documents...");
  const specDocs = await buildSpecDocuments();
  console.log(`Built ${specDocs.length} specification documents.`);

  // Check for any large documents
  for (const doc of specDocs) {
    if (doc.pageContent.length > LARGE_DOC_THRESHOLD) {
      const id = doc.metadata.sectionid || "unknown";
      const title = doc.metadata.sectiontitle || "unknown";
      console.warn(
        `🚨 Warning: Document ${id} "${title}" is large (${doc.pageContent.length} chars)`,
      );
    }
  }

  const db = await lancedbSdk.connect(STORAGE_DIR);

  // Check if table exists and handle overwrite
  let tableExists = false;
  try {
    await db.openTable("spec_vectors");
    tableExists = true;
    console.log("Existing table found.");
  } catch {
    console.log("No existing table found, creating fresh...");
  }

  if (tableExists) {
    const shouldOverwrite = await askUser(
      "Do you want to overwrite the existing vector store?",
    );
    if (!shouldOverwrite) {
      console.log("Ingest cancelled by user.");
      process.exit(0);
    }
    console.log("Overwriting existing table...");
    await db.dropTable("spec_vectors");
  }

  console.log("Generating embeddings...");
  const vectors = await generateEmbeddingsWithProgress(specDocs);

  console.log("Creating table with documents...");
  // Prepare data records with vector, text, and metadata
  const data = specDocs.map((doc, i) => ({
    vector: vectors[i],
    text: doc.pageContent,
    ...doc.metadata,
  }));

  // Create table with the data
  const table = await db.createTable("spec_vectors", data);

  console.log("Creating scalar indexes...");
  await table.createIndex("sectionid", { config: Index.btree() });
  await table.createIndex("type", { config: Index.btree() });

  console.log(`Index built and persisted to ${STORAGE_DIR}`);
}

main().catch(console.error);
