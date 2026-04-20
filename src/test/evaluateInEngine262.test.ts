/**
 * Tests for the evaluateInEngine262 tool.
 * Tests JavaScript code execution in engine262 and spec section capture.
 */

import { describe, expect, test } from "bun:test";
import { createEvaluateInEngine262Tool } from "../agent-tools/index.js";

describe("evaluateInEngine262", () => {
  const evaluateTool = createEvaluateInEngine262Tool();

  test("should execute simple arithmetic", async () => {
    const result = await evaluateTool({ code: "1 + 1" });

    expect(result.error).toBeUndefined();
    expect(result.importantSections).toBeArray();
    expect(result.otherSections).toBeArray();
    expect(result.consoleOutput).toBeArray();
  });

  test("should capture spec sections for array operations", async () => {
    const result = await evaluateTool({ code: "[1, 2, 3].map(x => x * 2)" });

    expect(result.error).toBeUndefined();
    expect(result.otherSections?.length).toBeGreaterThan(0);

    // Should include array-related spec sections
    const sectionIds = [
      ...(result.importantSections || []),
      ...(result.otherSections || []),
    ];
    expect(sectionIds.some((id) => id.includes("array"))).toBe(true);
  });

  test("should return error for syntax errors", async () => {
    const result = await evaluateTool({ code: "function {" });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("SyntaxError");
  });

  test("should return error for runtime errors", async () => {
    const result = await evaluateTool({ code: "null.foo" });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("TypeError");
  });

  test("should return error for reference errors", async () => {
    const result = await evaluateTool({ code: "arr.push(1)" });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("ReferenceError");
  });

  test("should capture console output", async () => {
    const result = await evaluateTool({
      code: "console.log('hello', 123); console.warn('test')",
    });

    expect(result.error).toBeUndefined();
    expect(result.consoleOutput?.length).toBeGreaterThan(0);

    const logEntry = result.consoleOutput?.find(
      (entry) => entry.method === "log",
    );
    expect(logEntry).toBeDefined();
  });

  test("should capture important sections with ask262Debug", async () => {
    const result = await evaluateTool({
      code: `
        ask262Debug.startImportant();
        [1, 2, 3].filter(x => x > 1);
        ask262Debug.stopImportant();
      `,
    });

    expect(result.error).toBeUndefined();
    expect(result.importantSections?.length).toBeGreaterThan(0);
  });

  test("should handle empty code", async () => {
    const result = await evaluateTool({ code: "" });

    // Empty code should either succeed or have a specific error
    expect(result).toBeDefined();
  });

  test("should handle complex code with multiple operations", async () => {
    const result = await evaluateTool({
      code: `
        const arr = [1, 2, 3];
        const doubled = arr.map(x => x * 2);
        const filtered = doubled.filter(x => x > 2);
        filtered.reduce((a, b) => a + b, 0);
      `,
    });

    expect(result.error).toBeUndefined();
    expect(result.otherSections?.length).toBeGreaterThan(0);
  });

  test("should timeout after 1 second by default", async () => {
    const result = await evaluateTool({
      code: "while (true) {}", // Infinite loop
    });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("timeout");
  });

  test("should return deduplicated section IDs", async () => {
    const result = await evaluateTool({
      code: "[1].map(x => x).map(x => x)",
    });

    expect(result.error).toBeUndefined();

    // Check that there are no duplicates within or between arrays
    const importantSet = new Set(result.importantSections || []);
    const otherSet = new Set(result.otherSections || []);

    // No duplicates within important
    expect(importantSet.size).toBe((result.importantSections || []).length);

    // No duplicates within other
    expect(otherSet.size).toBe((result.otherSections || []).length);

    // No overlap between important and other
    for (const id of result.importantSections || []) {
      expect(otherSet.has(id)).toBe(false);
    }
  });
});
