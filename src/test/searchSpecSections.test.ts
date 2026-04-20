/**
 * Tests for the searchSpecSections tool.
 * Tests vector search functionality to find relevant spec sections.
 */

import { describe, expect, test } from "bun:test";
import { createSearchSpecSectionsTool } from "../agent-tools/index.js";
import {
  createMockEmbeddings,
  createMockTable,
  defaultTestData,
} from "./utils/mock.js";

describe("searchSpecSections", () => {
  const mockTable = createMockTable(defaultTestData);
  const mockEmbeddings = createMockEmbeddings();
  const searchTool = createSearchSpecSectionsTool(mockTable, mockEmbeddings);

  test("should return results for a valid query", async () => {
    const result = await searchTool({ query: "array map" });

    expect(result.results).toBeArray();
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.length).toBeLessThanOrEqual(5); // Default limit
  });

  test("should return section metadata without content", async () => {
    const result = await searchTool({ query: "if statement" });

    const firstResult = result.results[0];
    expect(firstResult).toHaveProperty("sectionId");
    expect(firstResult).toHaveProperty("sectionTitle");
    expect(firstResult).toHaveProperty("vectorDistance");
    expect(firstResult).toHaveProperty("partIndex");
    expect(firstResult).toHaveProperty("totalParts");
    expect(firstResult).not.toHaveProperty("content");
  });

  test("should return valid section IDs", async () => {
    const result = await searchTool({ query: "loop iteration" });

    for (const item of result.results) {
      expect(item.sectionId).toBeString();
      expect(item.sectionId).toMatch(/^sec-/);
    }
  });

  test("should return valid section titles", async () => {
    const result = await searchTool({ query: "exception handling" });

    for (const item of result.results) {
      expect(item.sectionTitle).toBeString();
      expect(item.sectionTitle.length).toBeGreaterThan(0);
    }
  });

  test("should return vectorDistance as a number", async () => {
    const result = await searchTool({ query: "javascript" });

    for (const item of result.results) {
      expect(item.vectorDistance).toBeNumber();
      expect(item.vectorDistance).toBeGreaterThanOrEqual(0);
    }
  });

  test("should handle empty query", async () => {
    const result = await searchTool({ query: "" });

    expect(result.results).toBeArray();
    // May return results or empty depending on mock implementation
  });

  test("should handle complex queries", async () => {
    const result = await searchTool({
      query: "how does array prototype map method work with callbacks",
    });

    expect(result.results).toBeArray();
    expect(result.results.length).toBeGreaterThan(0);
  });

  test("should return partIndex and totalParts as numbers or null", async () => {
    const result = await searchTool({ query: "try catch" });

    for (const item of result.results) {
      if (item.partIndex !== null) {
        expect(item.partIndex).toBeNumber();
        expect(item.partIndex).toBeGreaterThanOrEqual(0);
      }
      if (item.totalParts !== null) {
        expect(item.totalParts).toBeNumber();
        expect(item.totalParts).toBeGreaterThan(0);
      }
    }
  });
});
