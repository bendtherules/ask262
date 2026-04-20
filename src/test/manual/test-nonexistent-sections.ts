#!/usr/bin/env bun
/**
 * Test to verify non-existing section IDs return found: false
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { createGetSectionContentTool } from "../../agent-tools/getSectionContent.js";
import { STORAGE_DIR } from "../../constants.js";

async function main() {
  console.log("Testing getSectionContent with non-existing section IDs...\n");

  try {
    const db = await lancedbSdk.connect(STORAGE_DIR);
    const table = await db.openTable("spec_vectors");

    const getSectionContentTool = createGetSectionContentTool(table);

    // Test with mix of existing and non-existing section IDs
    const result = await getSectionContentTool({
      sectionIds: [
        "sec-non-existent-12345", // Should not exist
        "sec-also-fake-99999", // Should not exist
      ],
      recursive: false,
    });

    console.log("=== RESULT ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("\n=== VERIFICATION ===");

    // Verify all sections are returned
    if (result.sections.length !== 2) {
      console.error(`❌ Expected 2 sections, got ${result.sections.length}`);
      process.exit(1);
    }

    // Verify non-existing sections have found: false
    for (const section of result.sections) {
      if (section.found !== false) {
        console.error(
          `❌ Section ${section.sectionId} should have found: false`,
        );
        process.exit(1);
      }
      if (!section.error) {
        console.error(
          `❌ Section ${section.sectionId} should have error message`,
        );
        process.exit(1);
      }
      if (section.content !== "") {
        console.error(
          `❌ Section ${section.sectionId} should have empty content`,
        );
        process.exit(1);
      }
      console.log(
        `✅ ${section.sectionId}: found=false, error="${section.error}"`,
      );
    }

    console.log("\n✅ All non-existing sections correctly return found: false");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
