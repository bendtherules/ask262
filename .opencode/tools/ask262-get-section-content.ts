/**
 * OpenCode custom tool: ask262_get_section_content
 * Retrieves full content from a specific ECMAScript spec section.
 */

import * as lancedbSdk from "@lancedb/lancedb";
import { tool } from "@opencode-ai/plugin";
import {
  createGetSectionContentTool,
  toolMetadata,
} from "../../src/agent-tools/getSectionContent.js";

export default tool({
  description: toolMetadata.description,
  args: {
    sectionId: tool.schema.string().describe(toolMetadata.args.sectionId),
    recursive: tool.schema
      .boolean()
      .default(true)
      .describe(toolMetadata.args.recursive),
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
    const result = await contentTool({ sectionId, recursive });

    return JSON.stringify(result, null, 2);
  },
});
