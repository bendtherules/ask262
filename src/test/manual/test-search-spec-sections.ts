#!/usr/bin/env bun
/**
 * Manual test script for ask262_search_spec_sections agent tool.
 * Tests the semantic vector search functionality.
 *
 * Usage: bun run src/test/manual/test-search-spec-sections.ts ["your search query"]
 *
 * Examples:
 *   bun run src/test/manual/test-search-spec-sections.ts
 *   bun run src/test/manual/test-search-spec-sections.ts "how does array prototype map work"
 *   bun run src/test/manual/test-search-spec-sections.ts "for statement evaluation"
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createSearchSpecSectionsTool } from "../../agent-tools";
import { EMBEDDING_MODEL, STORAGE_DIR } from "../../constants";

async function main() {
  // Get query from command line or use default
  const query =
    process.argv[2] ||
    "how does the if statement evaluation work in javascript";

  console.log("=== Testing ask262_search_spec_sections Tool ===\n");
  console.log(`Query: "${query}"\n`);
  console.log("Loading database and embeddings...");

  try {
    const embeddings = new OllamaEmbeddings({
      model: EMBEDDING_MODEL,
    });

    const db = await lancedbSdk.connect(STORAGE_DIR);
    const table = await db.openTable("spec_vectors");

    console.log("✓ Database loaded\n");
    console.log("Creating tool...");
    const searchSpecSectionsTool = createSearchSpecSectionsTool(
      table,
      embeddings,
    );
    console.log("✓ Tool created\n");

    console.log("Executing tool...\n");
    const result = await searchSpecSectionsTool.func({ query });

    console.log("=== TOOL OUTPUT ===");
    console.log(result);
    console.log("\n=== END OUTPUT ===");
  } catch (error) {
    console.error("\n✗ Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
