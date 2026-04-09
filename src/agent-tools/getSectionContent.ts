/**
 * Get section content tool.
 * Retrieves all text chunks from a specific specification section by sectionid.
 */

import type { Table } from "@lancedb/lancedb";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const getSectionContentSchema = z.object({
  sectionId: z
    .string()
    .describe("The section ID (e.g., 'sec-if-statement') to fetch chunks for"),
  recursive: z
    .boolean()
    .default(true)
    .describe(
      "If true, recursively fetches content from all child sections and their descendants. " +
        "If false, only returns content from the specified section itself. " +
        "Use false when you only need the specific section's content without subsections.",
    ),
});

/**
 * Creates the get section content tool.
 * Retrieves all text chunks from a specific specification section by sectionid.
 * Supports recursive fetching - if a section has children, it will fetch all descendants.
 * @param table - LanceDB table containing spec vectors
 */
export function createGetSectionContentTool(table: Table) {
  return new DynamicStructuredTool({
    name: "ask262_get_section_content",
    description:
      "Retrieves all text chunks from a specific specification section by sectionid. " +
      "Supports recursive fetching - if recursive=true and the section has children, it will fetch all descendants. " +
      "Use this to get complete content when you see 'Subsection available' or 'partial section' references.",
    schema: getSectionContentSchema,
    func: async ({ sectionId, recursive }) => {
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

        // Sort by partindex to maintain order (nulls last for single-part sections)
        const sortedResults = results.sort((a: unknown, b: unknown) => {
          const aIndex = (a as { partindex?: number }).partindex ?? Infinity;
          const bIndex = (b as { partindex?: number }).partindex ?? Infinity;
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

          // Add children to queue for recursive fetching only if recursive is true
          if (
            recursive &&
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
