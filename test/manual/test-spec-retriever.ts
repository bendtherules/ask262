/**
 * Manual test script for spec_retriever agent tool
 * Usage: bun run test/manual/test-spec-retriever.ts "your search query"
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createSpecRetrieverTool } from "../../agent-tools";
import { EMBEDDING_MODEL, STORAGE_DIR } from "../../constants";

async function main() {
  const query = process.argv[2] || "array.[[DefineOwnProperty]]";

  console.log(`Testing spec_retriever with query: "${query}"`);
  console.log("Loading database and embeddings...\n");

  const embeddings = new OllamaEmbeddings({
    model: EMBEDDING_MODEL,
  });

  const db = await lancedbSdk.connect(STORAGE_DIR);
  const table = await db.openTable("spec_vectors");

  console.log("Creating tool...\n");
  const specRetrieverTool = createSpecRetrieverTool(table, embeddings);

  console.log("Executing tool...\n");
  const result = await specRetrieverTool.func({ query });

  console.log("=== TOOL OUTPUT ===");
  console.log(result);
  console.log("\n=== END OUTPUT ===");
}

main().catch(console.error);
