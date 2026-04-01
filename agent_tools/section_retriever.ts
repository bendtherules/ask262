/**
 * Section chunk retriever tool.
 * Retrieves all text chunks from a specific specification section by sectionid.
 */

import type { Table } from "@lancedb/lancedb";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const sectionRetrieverSchema = z.object({
  sectionId: z
    .string()
    .describe("The section ID (e.g., 'sec-if-statement') to fetch chunks for"),
});

/**
 * Creates the section retriever tool.
 * @param table - LanceDB table containing spec vectors
 */
export function createSectionRetrieverTool(table: Table) {
  return new DynamicStructuredTool({
    name: "fetch_section_chunks",
    description:
      "Retrieves all text chunks from a specific specification section by sectionid. " +
      "Supports recursive fetching - if a section has children, it will fetch all descendants. " +
      "Use this to get complete content when you see 'Subsection available' or 'partial section' references.",
    schema: sectionRetrieverSchema,
    func: async ({ sectionId }) => {
      const allDocs: string[] = [];
      const queue: string[] = [sectionId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const results = await table
          .query()
          .where(`sectionid = '${currentId}'`)
          .limit(100)
          .toArray();

        // Sort by partIndex to maintain order (nulls last for single-part sections)
        const sortedResults = results.sort((a: unknown, b: unknown) => {
          const aIndex = (a as { partIndex?: number }).partIndex ?? Infinity;
          const bIndex = (b as { partIndex?: number }).partIndex ?? Infinity;
          return aIndex - bIndex;
        });

        for (const result of sortedResults) {
          const typedResult = result as {
            text?: string;
            childrensectionids?: string[];
            sectiontitle?: string;
          };

          if (typedResult.text) {
            allDocs.push(typedResult.text);
          }

          // Add children to queue for recursive fetching
          if (
            typedResult.childrensectionids &&
            Array.isArray(typedResult.childrensectionids)
          ) {
            queue.push(...typedResult.childrensectionids);
          }
        }
      }

      return allDocs.join("\n\n---\n\n");
    },
  });
}
