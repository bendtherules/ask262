/**
 * OpenCode custom tool: ask262_get_section_content
 * Retrieves full content from a specific ECMAScript spec section.
 */

import { tool } from "@opencode-ai/plugin";
import * as lancedbSdk from "@lancedb/lancedb";
import { createGetSectionContentTool } from "../../src/agent-tools";

export default tool({
  description:
    "Retrieves all text chunks from a specific ECMAScript specification section by section ID. " +
    "Supports recursive fetching - if recursive=true and the section has children, it will fetch all descendants. " +
    "Use this to get complete spec text when you know the section ID (e.g., 'sec-if-statement').",
  args: {
    sectionId: tool.schema
      .string()
      .describe(
        "The section ID (e.g., 'sec-if-statement', 'sec-array-prototype-map') to fetch content for",
      ),
    recursive: tool.schema
      .boolean()
      .default(true)
      .describe(
        "If true, recursively fetches content from all child sections and descendants. " +
          "If false, only returns content from the specified section itself. " +
          "Use false when you only need the specific section's content without subsections.",
      ),
  },
  async execute(args, context) {
    const { sectionId, recursive } = args;
    const { worktree } = context;

    // Connect to LanceDB
    const storageDir = `${worktree}/storage`;
    const db = await lancedbSdk.connect(storageDir);
    const table = await db.openTable("spec_vectors");

    // Create and execute tool
    const contentTool = createGetSectionContentTool(table);
    const result = await contentTool.func({ sectionId, recursive });

    return result;
  },
});
