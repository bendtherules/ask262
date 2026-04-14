/**
 * Get section content tool.
 * Retrieves all text chunks from a specific specification section by sectionid.
 */

import type { Table } from "@lancedb/lancedb";
import { z } from "zod";

// #region Zod schemas (not exported)

const sectionContentSchema = z.object({
  text: z.string(),
  sectionTitle: z.string().optional(),
  partIndex: z.number().optional(),
});

const getSectionContentOutputSchema = z.object({
  content: z.string(),
  sectionCount: z.number(),
});

// #endregion

// #region Exported Zod schemas

export const toolMetadata = {
  description:
    "Retrieves all text chunks from a specific specification section by sectionid. " +
    "Supports recursive fetching - if recursive=true and the section has children, it will fetch all descendants. " +
    "Use this to get complete content when you see 'Subsection available' or 'partial section' references.",
  args: {
    sectionId: "The section ID (e.g., 'sec-if-statement') to fetch chunks for",
    recursive:
      "If true, recursively fetches content from all child sections and their descendants. " +
      "If false, only returns content from the specified section itself. " +
      "Use false when you only need the specific section's content without subsections.",
  },
};

export const inputSchema = z.object({
  sectionId: z.string().describe(toolMetadata.args.sectionId),
  recursive: z.boolean().default(true).describe(toolMetadata.args.recursive),
});

export const outputSchema = getSectionContentOutputSchema;

export const toolName = "ask262_get_section_content";

// #endregion

// #region TypeScript types (inferred from Zod schemas)

export type SectionContent = z.infer<typeof sectionContentSchema>;

export type GetSectionContentOutput = z.infer<
  typeof getSectionContentOutputSchema
>;

export type GetSectionContentInput = z.infer<typeof inputSchema>;

// #endregion

/**
 * Creates the get section content tool function.
 * Retrieves all text chunks from a specific specification section by sectionid.
 * Supports recursive fetching - if a section has children, it will fetch all descendants.
 * @param table - LanceDB table containing spec vectors
 * @returns Function that retrieves content and returns structured output
 */
export function createGetSectionContentTool(table: Table) {
  return async ({
    sectionId,
    recursive,
  }: GetSectionContentInput): Promise<GetSectionContentOutput> => {
    const allDocs: string[] = [];
    const queue: string[] = [sectionId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) continue;
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

    return {
      content: allDocs.join("\n\n---\n\n"),
      sectionCount: visited.size,
    };
  };
}
