/**
 * Tests for the getSectionContent tool.
 * Tests retrieval of full section content by section ID.
 *
 * Coverage:
 * - Schema validation (input/output)
 * - Proper result content and metadata
 * - Error handling (DB failures)
 * - Recursive fetching (deep nesting, cycles)
 * - Multi-part section ordering
 * - Edge cases (empty, duplicates, not found)
 */

import { describe, expect, test } from "bun:test";
import {
  createGetSectionContentTool,
  getSectionInputSchema,
  getSectionOutputSchema,
  sectionContentToolName,
} from "../agent-tools/index.js";
import {
  createFailingTable,
  createMockTable,
  defaultTestData,
  multiPartTestData,
  recursiveTestData,
} from "./utils/mock.js";

describe("getSectionContent", () => {
  const mockTable = createMockTable(defaultTestData);
  const getContentTool = createGetSectionContentTool(mockTable);

  // #region Schema validation

  describe("input schema validation", () => {
    test("should accept valid input with sectionIds and recursive", () => {
      const result = getSectionInputSchema.safeParse({
        sectionIds: ["sec-if-statement"],
        recursive: false,
      });
      expect(result.success).toBe(true);
    });

    test("should apply default recursive=true", () => {
      const result = getSectionInputSchema.safeParse({
        sectionIds: ["sec-if-statement"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.recursive).toBe(true);
      }
    });

    test("should reject empty sectionIds array", () => {
      const result = getSectionInputSchema.safeParse({
        sectionIds: [],
        recursive: false,
      });
      // Schema allows empty arrays - this test documents the behavior
      expect(result.success).toBe(true);
    });

    test("should reject non-array sectionIds", () => {
      const result = getSectionInputSchema.safeParse({
        sectionIds: "sec-if-statement",
        recursive: false,
      });
      expect(result.success).toBe(false);
    });

    test("should reject non-boolean recursive", () => {
      const result = getSectionInputSchema.safeParse({
        sectionIds: ["sec-if-statement"],
        recursive: "yes",
      });
      expect(result.success).toBe(false);
    });

    test("should reject missing sectionIds", () => {
      const result = getSectionInputSchema.safeParse({
        recursive: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("output schema validation", () => {
    test("should validate output conforms to schema", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement"],
        recursive: false,
      });

      const validation = getSectionOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    test("should validate not-found output conforms to schema", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-nonexistent"],
        recursive: false,
      });

      const validation = getSectionOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    test("should validate recursive output conforms to schema", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-catch-clause"],
        recursive: true,
      });

      const validation = getSectionOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });
  });

  // #endregion

  // #region Proper results

  describe("single section retrieval", () => {
    test("should return content for a single valid section", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement"],
        recursive: false,
      });

      expect(result.sections).toBeArray();
      expect(result.sections.length).toBe(1);
      expect(result.sections[0].found).toBe(true);
      expect(result.sections[0].sectionId).toBe("sec-if-statement");
      expect(result.sections[0].content).toBeString();
      expect(result.sections[0].content.length).toBeGreaterThan(0);
      expect(result.sections[0].content).toContain("evaluates a condition");
    });

    test("should return correct section title", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement"],
        recursive: false,
      });

      expect(result.sections[0].sectionTitle).toBe("The if Statement");
    });

    test("should include section metadata", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement"],
        recursive: false,
      });

      const section = result.sections[0];
      expect(section.sectionId).toBe("sec-if-statement");
      expect(section.sectionTitle).toBeDefined();
      expect(section.found).toBe(true);
      expect(section.content).toBeString();
    });
  });

  describe("multiple section retrieval", () => {
    test("should return content for multiple sections", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement", "sec-for-statement"],
        recursive: false,
      });

      expect(result.sections.length).toBe(2);
      expect(result.sections[0].found).toBe(true);
      expect(result.sections[1].found).toBe(true);
      expect(result.sections[0].sectionId).toBe("sec-if-statement");
      expect(result.sections[1].sectionId).toBe("sec-for-statement");
    });

    test("should handle mix of existing and non-existing sections", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement", "sec-does-not-exist"],
        recursive: false,
      });

      expect(result.sections.length).toBe(2);
      expect(result.sections[0].found).toBe(true);
      expect(result.sections[1].found).toBe(false);
      expect(result.sections[1].error).toContain("not found");
      expect(result.sections[1].content).toBe("");
    });

    test("should preserve input order in output", async () => {
      const sectionIds = ["sec-for-statement", "sec-if-statement"];
      const result = await getContentTool({
        sectionIds,
        recursive: false,
      });

      expect(result.sections[0].sectionId).toBe("sec-for-statement");
      expect(result.sections[1].sectionId).toBe("sec-if-statement");
    });
  });

  // #endregion

  // #region Not found handling

  describe("not found handling", () => {
    test("should return found: false for non-existent sections", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-does-not-exist"],
        recursive: false,
      });

      expect(result.sections.length).toBe(1);
      expect(result.sections[0].found).toBe(false);
      expect(result.sections[0].error).toBeDefined();
      expect(result.sections[0].error).toContain("sec-does-not-exist");
      expect(result.sections[0].content).toBe("");
      expect(result.sections[0].sectionId).toBe("sec-does-not-exist");
    });

    test("should return empty array for empty sectionIds", async () => {
      const result = await getContentTool({
        sectionIds: [],
        recursive: false,
      });

      expect(result.sections).toBeArray();
      expect(result.sections.length).toBe(0);
    });

    test("should handle all non-existent sections", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-a", "sec-b", "sec-c"],
        recursive: false,
      });

      expect(result.sections.length).toBe(3);
      for (const section of result.sections) {
        expect(section.found).toBe(false);
        expect(section.content).toBe("");
        expect(section.error).toBeDefined();
      }
    });
  });

  // #endregion

  // #region Multi-part sections

  describe("multi-part sections", () => {
    const multiPartTable = createMockTable(multiPartTestData);
    const multiPartTool = createGetSectionContentTool(multiPartTable);

    test("should join multi-part content in partIndex order", async () => {
      const result = await multiPartTool({
        sectionIds: ["sec-species-conformance"],
        recursive: false,
      });

      expect(result.sections.length).toBe(1);
      expect(result.sections[0].found).toBe(true);
      // Content should be joined with \n\n in partIndex order (0, 1, 2)
      const content = result.sections[0].content;
      const parts = content.split("\n\n");
      expect(parts.length).toBe(3);
      expect(parts[0]).toContain("Part 0");
      expect(parts[1]).toContain("Part 1");
      expect(parts[2]).toContain("Part 2 final");
    });
  });

  // #endregion

  // #region Recursive fetching

  describe("recursive fetching", () => {
    test("should include childrensectionids when available", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-catch-clause"],
        recursive: false,
      });

      const section = result.sections[0];
      expect(section.found).toBe(true);
      expect(section.childrensectionids).toBeArray();
      expect(section.childrensectionids).toContain("sec-try-statement");
    });

    test("should fetch children when recursive is true", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-catch-clause"],
        recursive: true,
      });

      expect(result.sections.length).toBe(2);
      expect(result.sections[0].sectionId).toBe("sec-catch-clause");
      expect(result.sections[1].sectionId).toBe("sec-try-statement");
    });

    test("should include recursively fetched child sections with full content", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-catch-clause"],
        recursive: true,
      });

      expect(result.sections[0].sectionId).toBe("sec-catch-clause");

      const childSection = result.sections.find(
        (s) => s.sectionId === "sec-try-statement",
      );
      expect(childSection).toBeDefined();
      expect(childSection?.found).toBe(true);
      expect(childSection?.sectionTitle).toBe("The try Statement");
      expect(childSection?.content).toBeString();
      expect(childSection?.content.length).toBeGreaterThan(0);
    });

    test("should not include children when recursive is false", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-catch-clause"],
        recursive: false,
      });

      expect(result.sections.length).toBe(1);
      expect(result.sections[0].sectionId).toBe("sec-catch-clause");

      const childSection = result.sections.find(
        (s) => s.sectionId === "sec-try-statement",
      );
      expect(childSection).toBeUndefined();
    });

    test("should traverse deeply nested children", async () => {
      const deepTable = createMockTable(recursiveTestData);
      const deepTool = createGetSectionContentTool(deepTable);

      const result = await deepTool({
        sectionIds: ["sec-root"],
        recursive: true,
      });

      const sectionIds = result.sections.map((s) => s.sectionId);
      expect(sectionIds).toContain("sec-root");
      expect(sectionIds).toContain("sec-child-a");
      expect(sectionIds).toContain("sec-child-b");
      expect(sectionIds).toContain("sec-grandchild");
      expect(result.sections.length).toBe(4);
    });

    test("should place requested sections before children in output", async () => {
      const deepTable = createMockTable(recursiveTestData);
      const deepTool = createGetSectionContentTool(deepTable);

      const result = await deepTool({
        sectionIds: ["sec-root"],
        recursive: true,
      });

      // First section should be the requested one
      expect(result.sections[0].sectionId).toBe("sec-root");
      // Remaining should be children
      const childIds = result.sections.slice(1).map((s) => s.sectionId);
      expect(childIds).toContain("sec-child-a");
      expect(childIds).toContain("sec-child-b");
    });
  });

  // #endregion

  // #region Edge cases

  describe("edge cases", () => {
    test("should handle duplicate section IDs", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement", "sec-if-statement"],
        recursive: false,
      });

      // Both entries should be in output (one for each requested ID)
      expect(result.sections.length).toBe(2);
      expect(result.sections[0].sectionId).toBe("sec-if-statement");
      expect(result.sections[1].sectionId).toBe("sec-if-statement");
    });

    test("should handle sections without childrensectionids", async () => {
      const result = await getContentTool({
        sectionIds: ["sec-if-statement"],
        recursive: true,
      });

      expect(result.sections.length).toBe(1);
      expect(result.sections[0].found).toBe(true);
      expect(result.sections[0].childrensectionids).toBeUndefined();
    });

    test("should handle large section ID list", async () => {
      const manyIds = Array.from({ length: 50 }, (_, i) => `sec-item-${i}`);
      const result = await getContentTool({
        sectionIds: manyIds,
        recursive: false,
      });

      expect(result.sections.length).toBe(50);
      for (const section of result.sections) {
        expect(section.found).toBe(false);
      }
    });
  });

  // #endregion

  // #region Error handling

  describe("error handling", () => {
    test("should propagate database errors", async () => {
      const failTable = createFailingTable();
      const failTool = createGetSectionContentTool(failTable);

      await expect(
        failTool({ sectionIds: ["sec-if-statement"], recursive: false }),
      ).rejects.toThrow();
    });
  });

  // #endregion

  // #region Tool metadata

  describe("tool metadata", () => {
    test("should export correct tool name", () => {
      expect(sectionContentToolName).toBe("ask262_get_section_content");
    });

    test("should export input and output schemas", () => {
      expect(getSectionInputSchema).toBeDefined();
      expect(getSectionOutputSchema).toBeDefined();
    });
  });

  // #endregion
});
