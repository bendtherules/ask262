#!/usr/bin/env bun
/**
 * Manual verification script for inspecting LanceDB documents/chunks.
 *
 * Usage:
 *   bun run test/manual/verify-db.ts                    # Show summary (default command)
 *   bun run test/manual/verify-db.ts summary            # Show database summary
 *   bun run test/manual/verify-db.ts list               # List all sections
 *   bun run test/manual/verify-db.ts section <id>       # Show chunks for a section
 *   bun run test/manual/verify-db.ts search "query"     # Search by vector similarity (semantic search)
 *   bun run test/manual/verify-db.ts tree               # Show full section hierarchy
 *   bun run test/manual/verify-db.ts tree sec-ecmascript-language-source-code  # Show subtree from section
 *   bun run test/manual/verify-db.ts sample             # Show random samples
 *   bun run test/manual/verify-db.ts large              # Show large documents
 *   bun run test/manual/verify-db.ts --help            # Show help
 *   bun run test/manual/verify-db.ts <command> --help  # Show help for specific command
 */

import fs from "node:fs";
import type { Table } from "@lancedb/lancedb";
import * as lancedbSdk from "@lancedb/lancedb";
import { OllamaEmbeddings } from "@langchain/ollama";
import { Command } from "commander";
import { EMBEDDING_MODEL, STORAGE_DIR } from "../../constants";

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
});

interface DocumentRecord {
  vector: number[];
  text: string;
  source: string;
  sectionid: string;
  sectiontitle: string;
  type: string;
  parentsectionid: string | null;
  childrensectionids: string[];
  partindex: number;
  totalparts: number;
}

const program = new Command()
  .name("verify-db")
  .description(
    "Manual verification script for inspecting LanceDB documents/chunks",
  )
  .version("1.0.0");

async function getTable(): Promise<Table> {
  // Check if database exists
  if (!fs.existsSync(STORAGE_DIR)) {
    console.error(`❌ Storage directory not found: ${STORAGE_DIR}`);
    console.log("\nRun 'bun run ingest' first to create the database.");
    process.exit(1);
  }

  const db = await lancedbSdk.connect(STORAGE_DIR);

  // Check if table exists
  try {
    return await db.openTable("spec_vectors");
  } catch (error) {
    console.error("❌ Table 'spec_vectors' not found in database");
    console.log("\nRun 'bun run ingest' first to populate the database.");
    process.exit(1);
  }
}

program
  .command("summary")
  .description("Show database summary statistics")
  .action(async () => {
    const table = await getTable();
    await showSummary(table);
  });

program
  .command("list")
  .description("List all sections with chunk counts")
  .action(async () => {
    const table = await getTable();
    await listSections(table);
  });

program
  .command("section <id>")
  .description("Show all chunks for a specific section")
  .action(async (sectionId: string) => {
    const table = await getTable();
    await showSection(table, sectionId);
  });

program
  .command("search <query>")
  .description("Search by vector similarity (semantic search)")
  .option("-l, --limit <number>", "Number of results to show", "5")
  .action(async (query: string, options: { limit: string }) => {
    const table = await getTable();
    await vectorSearch(table, query, parseInt(options.limit));
  });

program
  .command("tree [section]")
  .description("Show section hierarchy tree")
  .action(async (section: string | undefined) => {
    const table = await getTable();
    await showTree(table, section);
  });

program
  .command("sample")
  .description("Show random samples")
  .option("-n, --count <number>", "Number of samples to show", "3")
  .action(async (options: { count: string }) => {
    const table = await getTable();
    await showSamples(table, parseInt(options.count));
  });

program
  .command("large")
  .description("Show documents larger than minimum size")
  .option("-m, --min <number>", "Minimum size in characters", "5000")
  .action(async (options: { min: string }) => {
    const table = await getTable();
    await showLargeDocs(table, parseInt(options.min));
  });

async function showSummary(table: Table) {
  console.log("\n📊 Database Summary:");

  // Get total count efficiently using countRows()
  const totalCount = await table.countRows();
  console.log(`  Total documents: ${totalCount}`);

  // Count unique sections
  const allRecords = (await table.query().toArray()) as DocumentRecord[];
  const sections = new Map<string, number>();
  const sizes = allRecords.map((r) => r.text.length);

  for (const record of allRecords) {
    sections.set(record.sectionid, (sections.get(record.sectionid) || 0) + 1);
  }

  console.log(`  Unique sections: ${sections.size}`);
  console.log(
    `  Multi-chunk sections: ${Array.from(sections.values()).filter((c) => c > 1).length}`,
  );
  console.log(`\n  Size distribution:`);
  if (sizes.length === 0) {
    console.log("    No documents to calculate size distribution");
  } else {
    console.log(
      `    Average: ${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(0)} chars`,
    );
    console.log(`    Min: ${Math.min(...sizes)} chars`);
    console.log(`    Max: ${Math.max(...sizes)} chars`);
  }

  // Show top 5 largest using sorted query
  const sortedBySize = [...allRecords].sort(
    (a, b) => b.text.length - a.text.length,
  );
  console.log(`\n  Top 5 largest documents:`);
  for (let i = 0; i < Math.min(5, sortedBySize.length); i++) {
    const r = sortedBySize[i];
    console.log(
      `    ${i + 1}. ${r.sectionid} (chunk ${r.partindex + 1}/${r.totalparts}): ${r.text.length} chars`,
    );
  }
}

async function listSections(table: Table) {
  // Query all records to properly count chunks per section
  const records = (await table
    .query()
    .select(["sectionid", "sectiontitle"])
    .toArray()) as DocumentRecord[];

  const sectionMap = new Map<string, { title: string; chunks: number }>();

  for (const record of records) {
    const existing = sectionMap.get(record.sectionid);
    if (existing) {
      // Increment chunk count for this section
      existing.chunks++;
    } else {
      sectionMap.set(record.sectionid, {
        title: record.sectiontitle,
        chunks: 1,
      });
    }
  }

  const sorted = Array.from(sectionMap.entries()).sort(
    (a, b) => b[1].chunks - a[1].chunks,
  );

  console.log(`\n📑 All Sections (${sorted.length} total):\n`);
  console.log("ID | Title | Chunks");
  console.log("-".repeat(80));

  for (const [id, info] of sorted) {
    const title =
      info.title.length > 50 ? info.title.slice(0, 47) + "..." : info.title;
    console.log(
      `${id.padEnd(30)} | ${title.padEnd(50)} | ${info.chunks.toString().padStart(3)}`,
    );
  }
}

async function showSection(table: Table, sectionId: string) {
  // Query with where() for efficient database filtering
  const records = (await table
    .query()
    .where(`sectionid = '${sectionId}'`)
    .toArray()) as DocumentRecord[];

  if (records.length === 0) {
    console.error(`❌ No records found for section: ${sectionId}`);
    console.error(
      '\nTip: Use "bun run test/manual/verify-db.ts list" to see all sections',
    );
    process.exit(1);
  }

  // Sort by part index
  const sectionRecords = records.sort((a, b) => a.partindex - b.partindex);
  const first = sectionRecords[0];

  console.log(`\n📄 Section: ${sectionId}`);
  console.log(`   Title: ${first.sectiontitle}`);
  console.log(`   Source: ${first.source}`);
  console.log(`   Parent: ${first.parentsectionid || "none"}`);

  // Handle childrensectionids which comes back as an Apache Arrow Vector
  const childrenIds = getChildrenIds(first);
  const childrenStr = childrenIds.length > 0 ? childrenIds.join(", ") : "none";
  console.log(`   Children: ${childrenStr}`);
  console.log(`   Total parts: ${first.totalparts}`);
  console.log(
    `   Total size: ${sectionRecords.reduce((sum, r) => sum + r.text.length, 0)} chars\n`,
  );

  for (const record of sectionRecords) {
    console.log(`─`.repeat(80));
    if (record.totalparts > 1) {
      console.log(
        `Part ${record.partindex + 1}/${record.totalparts} (${record.text.length} chars):\n`,
      );
    } else {
      console.log(`Content (${record.text.length} chars):\n`);
    }
    console.log(record.text);
    console.log();
  }
}

async function vectorSearch(table: Table, query: string, limit: number) {
  console.log(`\n🔍 Vector similarity search for "${query}"...`);
  console.log("   Generating embedding...");

  const queryVector = await embeddings.embedQuery(query);

  console.log("   Searching database...");
  // Use table.vectorSearch() which is the explicit/convenience method for vector search
  // Note: fastSearch() is available on Query but not VectorQuery, so we use standard search
  const results = (await table
    .vectorSearch(queryVector)
    .limit(limit)
    .toArray()) as DocumentRecord[];

  console.log(`\n   Top ${limit} most similar documents:\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const preview = r.text.replace(/\s+/g, " ").slice(0, 200);
    console.log(`${i + 1}. ${r.sectionid} (${r.sectiontitle})`);
    console.log(
      `   Chunk ${r.partindex + 1}/${r.totalparts} (${r.text.length} chars)`,
    );
    console.log(`   ${preview}${r.text.length > 200 ? "..." : ""}\n`);
  }
}

async function showTree(table: Table, sectionId?: string) {
  // Query all records for hierarchy analysis
  const records = (await table
    .query()
    .select([
      "sectionid",
      "sectiontitle",
      "parentsectionid",
      "childrensectionids",
    ])
    .toArray()) as DocumentRecord[];

  // Build hierarchy map
  const sectionMap = new Map<string, DocumentRecord>();
  const rootSections: DocumentRecord[] = [];

  for (const record of records) {
    if (!sectionMap.has(record.sectionid)) {
      sectionMap.set(record.sectionid, record);
      if (!record.parentsectionid) {
        rootSections.push(record);
      }
    }
  }

  // If a specific section is requested, show only that subtree
  if (sectionId) {
    const startSection = sectionMap.get(sectionId);
    if (!startSection) {
      console.error(`❌ Section not found: ${sectionId}`);
      console.error(
        '\nTip: Use "bun run test/manual/verify-db.ts list" to see all sections',
      );
      process.exit(1);
    }

    console.log(`\n🌳 Section Hierarchy for ${sectionId}:\n`);
    printTreeNode(startSection, sectionMap, "", true);
    return;
  }

  console.log(`\n🌳 Section Hierarchy (${sectionMap.size} sections):\n`);

  // Sort root sections
  rootSections.sort((a, b) => a.sectionid.localeCompare(b.sectionid));

  for (let i = 0; i < rootSections.length; i++) {
    const isLast = i === rootSections.length - 1;
    printTreeNode(rootSections[i], sectionMap, "", isLast);
  }
}

function printTreeNode(
  node: DocumentRecord,
  sectionMap: Map<string, DocumentRecord>,
  prefix: string,
  isLast: boolean,
): void {
  const connector = isLast ? "└── " : "├── ";
  const title =
    node.sectiontitle.length > 50
      ? node.sectiontitle.slice(0, 47) + "..."
      : node.sectiontitle;
  console.log(`${prefix}${connector}${node.sectionid}`);
  console.log(`${prefix}${isLast ? "    " : "│   "} ${title}`);

  // Get children
  const children: DocumentRecord[] = [];
  const childIds = getChildrenIds(node);
  for (const childId of childIds) {
    const child = sectionMap.get(childId);
    if (child) {
      children.push(child);
    }
  }

  children.sort((a, b) => a.sectionid.localeCompare(b.sectionid));

  const childPrefix = prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < children.length; i++) {
    const isLastChild = i === children.length - 1;
    printTreeNode(children[i], sectionMap, childPrefix, isLastChild);
  }
}

function getChildrenIds(node: DocumentRecord): string[] {
  // Array.from() works on both plain arrays and Apache Arrow Vectors
  // because Arrow Vectors implement [Symbol.iterator]
  return Array.from(node.childrensectionids as Iterable<string>);
}

async function showSamples(table: Table, count: number) {
  // Query all records but limit fields
  const records = (await table
    .query()
    .select(["sectionid", "sectiontitle", "partindex", "totalparts", "text"])
    .toArray()) as DocumentRecord[];

  const shuffled = [...records].sort(() => 0.5 - Math.random());
  const samples = shuffled.slice(0, count);

  console.log(`\n🎲 ${count} Random Samples:\n`);

  for (let i = 0; i < samples.length; i++) {
    const r = samples[i];
    console.log(`─`.repeat(80));
    console.log(`Sample ${i + 1}: ${r.sectionid}`);
    console.log(`Title: ${r.sectiontitle}`);
    console.log(
      `Chunk: ${r.partindex + 1}/${r.totalparts} (${r.text.length} chars)\n`,
    );
    console.log(r.text.slice(0, 400));
    if (r.text.length > 400) {
      console.log(`\n... (${r.text.length - 400} more characters)`);
    }
    console.log();
  }
}

async function showLargeDocs(table: Table, minSize: number) {
  // Query with limit to text field only
  const records = (await table
    .query()
    .select(["sectionid", "partindex", "totalparts", "text"])
    .toArray()) as DocumentRecord[];

  const large = records
    .filter((r) => r.text.length > minSize)
    .sort((a, b) => b.text.length - a.text.length);

  console.log(
    `\n📏 Documents larger than ${minSize} chars (${large.length} found):\n`,
  );

  for (const r of large) {
    console.log(
      `${r.sectionid} (chunk ${r.partindex + 1}/${r.totalparts}): ${r.text.length} chars`,
    );
  }
}

if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}
