import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import * as lancedbSdk from "@lancedb/lancedb";
import { Index } from "@lancedb/lancedb";
import { Document } from "@langchain/core/documents";
import { OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import * as cheerio from "cheerio";
import { glob } from "glob";
import ora from "ora";
import { EMBEDDING_MODEL, SPEC_DIR, STORAGE_DIR } from "../constants";

// TODO: Debug small content chunks

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
});

const htmlSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 8192, // ~2048 tokens, keeps most algorithms intact
  chunkOverlap: 200, // Increased overlap for better continuity
  separators: [
    "<emu-note",
    "<emu-example",
    "<emu-table",
    "<emu-grammar",
    "<td",
    // Finally, try to split along HTML tags
    "<h3",
    "<h4",
    "<h5",
    "<h6",
    "<p",
    "<div",
    "<br",
    "<li",
    "<span",
    "<ul",
    "<ol",
  ],
});

const LARGE_DOC_THRESHOLD = 9500;
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
    const $ = cheerio.load(content);

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
      const $section = cheerio.load(section.html).root();

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
        // console.log(
        //   `  Skipping section ${id} - only contains heading, no substantive content`,
        // );
        continue;
      }

      // Get HTML content with inline placeholders for splitting
      const sectionHtml = $section.html() || "";

      // Create temp document with HTML content for splitting
      const tempDoc = new Document({
        pageContent: sectionHtml,
        metadata: {
          source: path.basename(file),
          sectionid: id,
          sectiontitle: section.title,
          type: "specification",
        },
      });

      // Split the document
      const chunks = await htmlSplitter.splitDocuments([tempDoc]);

      // Log if large section wasn't split properly
      if (sectionHtml.length > LARGE_DOC_THRESHOLD && chunks.length === 1) {
        console.warn(
          `  ⚠️ Section ${id} (${section.title}) is large (${sectionHtml.length} chars) but was NOT split (1 chunk)`,
        );
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Extract text from HTML chunk
        const chunkText = cheerio.load(chunk.pageContent).text().trim();

        // Warn if chunk is very small
        const MIN_CHUNK_SIZE = 50;
        if (chunkText.length < MIN_CHUNK_SIZE) {
          console.warn(
            `  ⚠️ WARNING: Chunk ${i + 1}/${chunks.length} for section ${id} is very small (${chunkText.length} chars)`,
          );
          console.warn(`     Chunk content: "${chunk.pageContent}"`);
          // Clean up whitespace in HTML for cleaner log output
          const cleanedHtml = sectionHtml.replace(/\s+/g, " ").trim();
          console.warn(
            `     Original text that was split (${sectionHtml.length} chars):`,
          );
          console.warn(
            `     "${cleanedHtml.slice(0, 500)}${cleanedHtml.length > 500 ? "... [truncated]" : ""}"`,
          );
        }

        documents.push(
          new Document({
            pageContent: chunkText,
            metadata: {
              source: path.basename(file),
              sectionid: id,
              sectiontitle: section.title,
              type: "specification",
              parentsectionid: section.parentId,
              childrensectionids: section.childrenIds,
              partIndex: chunks.length > 1 ? i : null,
              totalParts: chunks.length,
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
        `⚠️  Warning: Document ${id} "${title}" is large (${doc.pageContent.length} chars)`,
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
