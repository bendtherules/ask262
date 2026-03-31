import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import * as lancedbSdk from "@lancedb/lancedb";
import { Index } from "@lancedb/lancedb";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
import { Document } from "@langchain/core/documents";
import { OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import * as cheerio from "cheerio";
import { glob } from "glob";
import { SPEC_DIR, STORAGE_DIR } from "../constants";

const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text-v2-moe",
});

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 4096,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

const BREAKDOWN_TAGS = ["emu-table", "emu-grammar"] as const;
const LARGE_DOC_THRESHOLD = 5000;

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

async function ingestSpec(): Promise<Document[]> {
  const htmlFiles = await glob(path.join(SPEC_DIR, "*.html"));
  const documents: Document[] = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(content);

    $("emu-clause").each((_i, elem) => {
      const id = $(elem).attr("id");
      const title = $(elem).find("h1").first().text().trim();
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

      // For large documents, break down by structural tags
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
                  pageContent: subText,
                  metadata: {
                    source: file,
                    sectionid: subId,
                    sectiontitle: `${title} [${tagName}]`,
                    type: "specification",
                    parentsectionid: id,
                    breakdowntag: tagName,
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
              pageContent: remainingText,
              metadata: {
                source: file,
                sectionid: `${id}-prose-part-1`,
                sectiontitle: `${title} [prose]`,
                type: "specification",
                parentsectionid: id,
                breakdowntag: "prose",
              },
            }),
          );
        }

        // Skip adding the full section since we've broken it into parts
        if (subDocsCreated || remainingText) {
          return;
        }
      }

      // Add the full section document (for smaller sections or when no breakdown happened)
      documents.push(
        new Document({
          pageContent: text,
          metadata: {
            source: file,
            sectionid: id,
            sectiontitle: title,
            type: "specification",
            parentsectionid: null,
            breakdowntag: null,
          },
        }),
      );
    });
  }
  return documents;
}

async function main() {
  console.log("Ingesting specification...");
  const specDocs = await ingestSpec();
  console.log(`Ingested ${specDocs.length} specification sections.`);

  console.log("Splitting documents into chunks...");
  const splitDocs = await textSplitter.splitDocuments(specDocs);
  console.log(`Total chunks generated: ${splitDocs.length}`);

  const db = await lancedbSdk.connect(STORAGE_DIR);

  let table: lancedbSdk.Table;
  try {
    table = await db.openTable("spec_vectors");
    console.log("Existing table found.");
    const shouldOverwrite = await askUser(
      "Do you want to overwrite the existing vector store?",
    );
    if (!shouldOverwrite) {
      console.log("Ingest cancelled by user.");
      process.exit(0);
    }
    console.log("Overwriting existing table...");
    await db.dropTable("spec_vectors");
    table = await db.createTable("spec_vectors", []);
  } catch {
    console.log("No existing table found, creating fresh...");
    table = await db.createTable("spec_vectors", []);
  }

  console.log("Creating scalar indexes...");
  await table.createIndex("sectionid", { config: Index.btree() });
  await table.createIndex("type", { config: Index.btree() });

  console.log("Storing documents with embeddings...");
  const vectorStore = new LanceDB(embeddings, { table });
  await vectorStore.addDocuments(splitDocs);

  console.log(`Index built and persisted to ${STORAGE_DIR}`);
}

main().catch(console.error);
