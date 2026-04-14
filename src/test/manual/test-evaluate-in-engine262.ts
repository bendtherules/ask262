#!/usr/bin/env bun
/**
 * Manual test script for evaluateInEngine262 agent tool.
 * Tests that the tool properly executes JavaScript code in engine262
 * and captures spec section marks.
 *
 * Usage: bun run src/test/manual/test-evaluate-in-engine262.ts ["your JavaScript code"]
 */

import { createEvaluateInEngine262Tool } from "../../agent-tools/index.js";

async function main() {
  // Get test code from command line or use default
  const testCode =
    process.argv[2] ||
    `
    // Test Array.prototype.every
    [1, 2, 3].every(x => x > 0);
    
    ask262Debug.startImportant();
    // Test Proxy creation
    new Proxy({}, {});
    ask262Debug.stopImportant();
  `;

  console.log("=== Testing evaluateInEngine262 Tool ===\n");
  console.log("Test code:");
  console.log("---");
  console.log(testCode);
  console.log("---\n");

  console.log("Creating tool...\n");
  const evaluateTool = createEvaluateInEngine262Tool();

  console.log("Executing tool...\n");
  try {
    const result = await evaluateTool({ code: testCode });

    // Verify results
    if ("error" in result) {
      throw new Error(result.error);
    }

    const importantCount = result.importantSections.length;
    const otherCount = result.otherSections.length;
    const totalCount = importantCount + otherCount;

    console.log(`\n✓ Captured ${totalCount} marks`);
    console.log(`  (${importantCount} important, ${otherCount} other)`);
    console.log("");

    // Flatten and dedupe section IDs
    const importantIds = new Set(result.importantSections);
    const otherIds = new Set(
      result.otherSections.filter((id: string) => !importantIds.has(id)),
    );

    const totalUnique = importantIds.size + otherIds.size;

    // Show important sections first
    const sortedIds = [...importantIds, ...otherIds];

    sortedIds.slice(0, 50).forEach((id) => {
      const isImportant = importantIds.has(id);
      const marker = isImportant ? "[IMPORTANT] " : "            ";
      console.log(`  ${marker}${id}`);
    });

    if (totalUnique > 50) {
      console.log(`\n  ... and ${totalUnique - 50} more`);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main().catch(console.error);
