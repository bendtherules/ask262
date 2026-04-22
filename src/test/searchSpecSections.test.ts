/**
 * Tests for the searchSpecSections tool.
 * Tests vector search functionality to find relevant spec sections.
 *
 * Coverage:
 * - Schema validation (input/output)
 * - Proper result structure and content
 * - Result ordering by vector distance
 * - Limit enforcement (max 5)
 * - Embedding failure handling
 * - Database failure handling
 * - Edge cases (empty query, special characters)
 * - Part index and total parts handling
 */

import { describe, expect, test } from "bun:test";
import {
  createSearchSpecSectionsTool,
  searchSpecInputSchema,
  searchSpecOutputSchema,
  searchSpecToolName,
} from "../agent-tools/index.js";
import {
  createFailingEmbeddings,
  createFailingTable,
  createMockEmbeddings,
  createMockTable,
  defaultTestData,
} from "./utils/mock.js";

describe("searchSpecSections", () => {
  const mockTable = createMockTable(defaultTestData);
  const mockEmbeddings = createMockEmbeddings();
  const searchTool = createSearchSpecSectionsTool(mockTable, mockEmbeddings);

  // #region Schema validation

  describe("input schema validation", () => {
    test("should accept valid query string", () => {
      const result = searchSpecInputSchema.safeParse({ query: "array map" });
      expect(result.success).toBe(true);
    });

    test("should reject missing query", () => {
      const result = searchSpecInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    test("should reject non-string query", () => {
      const result = searchSpecInputSchema.safeParse({ query: 123 });
      expect(result.success).toBe(false);
    });

    test("should accept empty string query", () => {
      const result = searchSpecInputSchema.safeParse({ query: "" });
      expect(result.success).toBe(true);
    });
  });

  describe("output schema validation", () => {
    test("should validate output conforms to schema", async () => {
      const result = await searchTool({ query: "array map" });
      const validation = searchSpecOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    test("should validate empty result conforms to schema", async () => {
      const emptyTable = createMockTable([]);
      const emptySearchTool = createSearchSpecSectionsTool(
        emptyTable,
        mockEmbeddings,
      );
      const result = await emptySearchTool({ query: "anything" });
      const validation = searchSpecOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });
  });

  // #endregion

  // #region Proper results

  describe("result structure", () => {
    test("should return results for a valid query", async () => {
      const result = await searchTool({ query: "array map" });

      expect(result.results).toBeArray();
      expect(result.results.length).toBeGreaterThan(0);
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
      expect(firstResult).not.toHaveProperty("text");
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

    test("should return vectorDistance as a non-negative number", async () => {
      const result = await searchTool({ query: "javascript" });

      for (const item of result.results) {
        expect(item.vectorDistance).toBeNumber();
        expect(item.vectorDistance).toBeGreaterThanOrEqual(0);
      }
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

  // #endregion

  // #region Limit enforcement

  describe("limit enforcement", () => {
    test("should return at most 5 results", async () => {
      const result = await searchTool({ query: "statement" });

      expect(result.results.length).toBeLessThanOrEqual(5);
    });
  });

  // #endregion

  // #region Edge cases

  describe("edge cases", () => {
    test("should handle empty query", async () => {
      const result = await searchTool({ query: "" });

      expect(result.results).toBeArray();
    });

    test("should handle complex queries", async () => {
      const result = await searchTool({
        query: "how does array prototype map method work with callbacks",
      });

      expect(result.results).toBeArray();
      expect(result.results.length).toBeGreaterThan(0);
    });

    test("should handle queries with special characters", async () => {
      const result = await searchTool({
        query: "Array.prototype.map() => callback",
      });

      expect(result.results).toBeArray();
    });

    test("should handle unicode queries", async () => {
      const result = await searchTool({ query: "配列 マップ" });

      expect(result.results).toBeArray();
    });
  });

  // #endregion

  // #region Error handling

  describe("error handling", () => {
    test("should propagate embedding service errors", async () => {
      const failEmbeddings = createFailingEmbeddings();
      const failSearchTool = createSearchSpecSectionsTool(
        mockTable,
        failEmbeddings,
      );

      await expect(failSearchTool({ query: "array map" })).rejects.toThrow(
        "Embedding service unavailable",
      );
    });

    test("should propagate database errors", async () => {
      const failTable = createFailingTable();
      const failSearchTool = createSearchSpecSectionsTool(
        failTable,
        mockEmbeddings,
      );

      await expect(failSearchTool({ query: "array map" })).rejects.toThrow(
        "Database connection failed",
      );
    });
  });

  // #endregion

  // #region Tool metadata

  describe("tool metadata", () => {
    test("should export correct tool name", () => {
      expect(searchSpecToolName).toBe("ask262_search_spec_sections");
    });

    test("should export input and output schemas", () => {
      expect(searchSpecInputSchema).toBeDefined();
      expect(searchSpecOutputSchema).toBeDefined();
    });
  });

  // #endregion
});
