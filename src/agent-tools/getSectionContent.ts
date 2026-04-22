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

const sectionDataSchema = z.object({
  sectionId: z.string(),
  content: z.string(),
  found: z.boolean(),
  error: z.string().optional(),
  sectionTitle: z.string().optional(),
  childrensectionids: z.array(z.string()).optional(),
});

const getSectionContentOutputSchema = z.object({
  sections: z.array(sectionDataSchema),
});

// #endregion

// #region Exported Zod schemas

export const toolMetadata = {
  description:
    "Retrieves all text chunks from one or more specification sections by section IDs. " +
    "Supports recursive fetching - if recursive=true and a section has children, it will fetch all descendants. " +
    "Use this to get complete content when you see 'Subsection available' or 'partial section' references.",
  args: {
    sectionIds:
      "Array of section IDs (e.g., ['sec-if-statement', 'sec-for-statement']) to fetch chunks for",
    recursive:
      "If true, recursively fetches content from all child sections and their descendants. " +
      "If false, only returns content from the specified sections themselves. " +
      "Use false when you only need the specific sections' content without subsections.",
  },
};

export const inputSchema = z.object({
  sectionIds: z.array(z.string()).describe(toolMetadata.args.sectionIds),
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
    sectionIds,
    recursive,
  }: GetSectionContentInput): Promise<GetSectionContentOutput> => {
    const sectionsData = new Map<
      string,
      {
        content: string[];
        title?: string;
        childrenSectionIds?: string[];
      }
    >();
    const queue: string[] = [...sectionIds];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);

      const results = await table
        .query()
        .where(`sectionid = '${currentId}'`)
        .limit(10)
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
          childrensectionids?: unknown;
          sectiontitle?: string;
          partindex?: number;
          totalparts?: number;
        };

        // Normalize childrensectionids: LanceDB may return an Apache Arrow Vector
        // which is iterable but not a plain JS array.
        const childrenIds = typedResult.childrensectionids
          ? Array.from(typedResult.childrensectionids as Iterable<string>)
          : undefined;

        // Get or create section data
        let section = sectionsData.get(currentId);
        if (!section) {
          section = {
            content: [],
            title: typedResult.sectiontitle,
            childrenSectionIds: childrenIds,
          };
          sectionsData.set(currentId, section);
        }

        if (typedResult.text) {
          section.content.push(typedResult.text);
        }

        // Add children to queue for recursive fetching only if recursive is true
        if (recursive && childrenIds && childrenIds.length > 0) {
          queue.push(...childrenIds);
        }
      }
    }

    // Build output array from all requested sections
    // Missing sections are included with found: false and error message
    const sections = sectionIds.map((id) => {
      const data = sectionsData.get(id);
      if (data) {
        return {
          sectionId: id,
          content: data.content.join("\n\n"),
          found: true,
          sectionTitle: data.title,
          childrensectionids: data.childrenSectionIds,
        };
      }
      return {
        sectionId: id,
        content: "",
        found: false,
        error: `Section '${id}' not found in database`,
      };
    });

    return {
      sections,
    };
  };
}
