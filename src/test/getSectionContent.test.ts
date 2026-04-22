/**
 * Tests for the getSectionContent tool.
 * Tests retrieval of full section content by section ID.
 */

import { describe, expect, test } from "bun:test";
import { createGetSectionContentTool } from "../agent-tools/index.js";
import { createMockTable, defaultTestData } from "./utils/mock.js";

describe("getSectionContent", () => {
  const mockTable = createMockTable(defaultTestData);
  const getContentTool = createGetSectionContentTool(mockTable);

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
  });

  test("should return content for multiple sections", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-if-statement", "sec-for-statement"],
      recursive: false,
    });

    expect(result.sections.length).toBe(2);
    expect(result.sections[0].found).toBe(true);
    expect(result.sections[1].found).toBe(true);
  });

  test("should return found: false for non-existent sections", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-does-not-exist"],
      recursive: false,
    });

    expect(result.sections.length).toBe(1);
    expect(result.sections[0].found).toBe(false);
    expect(result.sections[0].error).toBeDefined();
    expect(result.sections[0].content).toBe("");
  });

  test("should handle mix of existing and non-existing sections", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-if-statement", "sec-does-not-exist"],
      recursive: false,
    });

    expect(result.sections.length).toBe(2);
    expect(result.sections[0].found).toBe(true);
    expect(result.sections[1].found).toBe(false);
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
  });

  test("should return empty array for empty sectionIds", async () => {
    const result = await getContentTool({
      sectionIds: [],
      recursive: false,
    });

    expect(result.sections).toBeArray();
    expect(result.sections.length).toBe(0);
  });

  test("should include childrensectionids when available", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-catch-clause"],
      recursive: false,
    });

    const section = result.sections[0];
    if (section.found && section.childrensectionids !== undefined) {
      expect(section.childrensectionids).toBeArray();
    }
  });

  test("should fetch children when recursive is true", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-catch-clause"],
      recursive: true,
    });

    // Should include at least the requested section
    expect(result.sections.length).toBeGreaterThan(0);
    const requestedSection = result.sections.find(
      (s) => s.sectionId === "sec-catch-clause",
    );
    expect(requestedSection).toBeDefined();
    expect(requestedSection?.found).toBe(true);
  });

  test("should include recursively fetched child sections in output", async () => {
    const result = await getContentTool({
      sectionIds: ["sec-catch-clause"],
      recursive: true,
    });

    // sec-catch-clause has sec-try-statement as a child in mock data
    const childSection = result.sections.find(
      (s) => s.sectionId === "sec-try-statement",
    );
    expect(childSection).toBeDefined();
    expect(childSection?.found).toBe(true);
    expect(childSection?.content).toBeString();
    expect(childSection?.content.length).toBeGreaterThan(0);
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
