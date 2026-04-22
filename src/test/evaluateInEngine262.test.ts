/**
 * Tests for the evaluateInEngine262 tool.
 * Tests JavaScript code execution in engine262 and spec section capture.
 *
 * Coverage:
 * - Schema validation (input/output)
 * - Proper result structure for success and error
 * - Syntax errors, runtime errors, reference errors
 * - Console output capture (log, warn, debug, error)
 * - ask262Debug important sections
 * - Timeout behavior (default and custom)
 * - Section deduplication
 * - Edge cases (empty code, whitespace, long code)
 * - Complex multi-operation code
 */

import { describe, expect, test } from "bun:test";
import {
  createEvaluateInEngine262Tool,
  evaluateInputSchema,
  evaluateOutputSchema,
  evaluateToolName,
} from "../agent-tools/index.js";

describe("evaluateInEngine262", () => {
  const evaluateTool = createEvaluateInEngine262Tool();

  // #region Schema validation

  describe("input schema validation", () => {
    test("should accept valid code string", () => {
      const result = evaluateInputSchema.safeParse({ code: "1 + 1" });
      expect(result.success).toBe(true);
    });

    test("should reject missing code", () => {
      const result = evaluateInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    test("should reject non-string code", () => {
      const result = evaluateInputSchema.safeParse({ code: 123 });
      expect(result.success).toBe(false);
    });

    test("should accept empty string code", () => {
      const result = evaluateInputSchema.safeParse({ code: "" });
      expect(result.success).toBe(true);
    });
  });

  describe("output schema validation", () => {
    test("should validate success output conforms to schema", async () => {
      const result = await evaluateTool({ code: "1 + 1" });
      const validation = evaluateOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });

    test("should validate error output conforms to schema", async () => {
      const result = await evaluateTool({ code: "function {" });
      const validation = evaluateOutputSchema.safeParse(result);
      expect(validation.success).toBe(true);
    });
  });

  // #endregion

  // #region Success cases

  describe("successful execution", () => {
    test("should execute simple arithmetic", async () => {
      const result = await evaluateTool({ code: "1 + 1" });

      expect(result.error).toBeUndefined();
      expect(result.importantSections).toBeArray();
      expect(result.otherSections).toBeArray();
      expect(result.consoleOutput).toBeArray();
    });

    test("should capture spec sections for array operations", async () => {
      const result = await evaluateTool({
        code: "[1, 2, 3].map(x => x * 2)",
      });

      expect(result.error).toBeUndefined();
      expect(result.otherSections?.length).toBeGreaterThan(0);

      const sectionIds = [
        ...(result.importantSections || []),
        ...(result.otherSections || []),
      ];
      expect(sectionIds.some((id) => id.includes("array"))).toBe(true);
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

    test("should handle string operations", async () => {
      const result = await evaluateTool({
        code: "'hello'.toUpperCase()",
      });

      expect(result.error).toBeUndefined();
      expect(result.importantSections).toBeArray();
      expect(result.otherSections).toBeArray();
    });

    test("should handle object operations", async () => {
      const result = await evaluateTool({
        code: "Object.keys({a: 1, b: 2})",
      });

      expect(result.error).toBeUndefined();
      expect(result.otherSections?.length).toBeGreaterThan(0);
    });

    test("should handle class definitions", async () => {
      const result = await evaluateTool({
        code: `
          class Foo {
            constructor(x) { this.x = x; }
            getX() { return this.x; }
          }
          new Foo(42).getX();
        `,
      });

      expect(result.error).toBeUndefined();
    });
  });

  // #endregion

  // #region Error cases

  describe("error handling", () => {
    test("should return error for syntax errors", async () => {
      const result = await evaluateTool({ code: "function {" });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("SyntaxError");
      expect(result.importantSections).toBeUndefined();
      expect(result.otherSections).toBeUndefined();
      expect(result.consoleOutput).toBeUndefined();
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

    test("should return error for throw statements", async () => {
      const result = await evaluateTool({
        code: "throw new Error('custom error')",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("custom error");
    });
  });

  // #endregion

  // #region Console output

  describe("console output", () => {
    test("should capture console.log output", async () => {
      const result = await evaluateTool({
        code: "console.log('hello', 123)",
      });

      expect(result.error).toBeUndefined();
      expect(result.consoleOutput?.length).toBeGreaterThan(0);

      const logEntry = result.consoleOutput?.find(
        (entry) => entry.method === "log",
      );
      expect(logEntry).toBeDefined();
      expect(logEntry?.values).toContain("hello");
      expect(logEntry?.values).toContain(123);
    });

    test("should capture console.warn output", async () => {
      const result = await evaluateTool({
        code: "console.warn('warning message')",
      });

      expect(result.error).toBeUndefined();
      const warnEntry = result.consoleOutput?.find(
        (entry) => entry.method === "warn",
      );
      expect(warnEntry).toBeDefined();
      expect(warnEntry?.values).toContain("warning message");
    });

    test("should capture multiple console calls", async () => {
      const result = await evaluateTool({
        code: "console.log('first'); console.warn('second'); console.log('third')",
      });

      expect(result.error).toBeUndefined();
      expect(result.consoleOutput?.length).toBeGreaterThanOrEqual(3);
    });

    test("should capture mixed console methods", async () => {
      const result = await evaluateTool({
        code: "console.log('log'); console.warn('warn'); console.error('error'); console.debug('debug')",
      });

      expect(result.error).toBeUndefined();
      const methods = result.consoleOutput?.map((e) => e.method) ?? [];
      expect(methods).toContain("log");
      expect(methods).toContain("warn");
      expect(methods).toContain("error");
      expect(methods).toContain("debug");
    });
  });

  // #endregion

  // #region Important sections

  describe("important sections with ask262Debug", () => {
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

    test("should separate important and other sections", async () => {
      const result = await evaluateTool({
        code: `
          [1, 2].map(x => x);
          ask262Debug.startImportant();
          [3, 4].filter(x => x > 3);
          ask262Debug.stopImportant();
        `,
      });

      expect(result.error).toBeUndefined();
      expect(result.importantSections?.length).toBeGreaterThan(0);
      expect(result.otherSections?.length).toBeGreaterThan(0);
    });
  });

  // #endregion

  // #region Timeout

  describe("timeout behavior", () => {
    test("should timeout after 1 second by default", async () => {
      const result = await evaluateTool({
        code: "while (true) {}",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("timeout");
    });

    test("should respect custom timeout", async () => {
      const slowTool = createEvaluateInEngine262Tool(500);
      const result = await slowTool({
        code: "while (true) {}",
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain("timeout");
      expect(result.error).toContain("500ms");
    });

    test("should complete within long timeout for slow code", async () => {
      const longTool = createEvaluateInEngine262Tool(5000);
      const result = await longTool({
        code: `
          let sum = 0;
          for (let i = 0; i < 1000; i++) { sum += i; }
          sum;
        `,
      });

      expect(result.error).toBeUndefined();
    });
  });

  // #endregion

  // #region Deduplication

  describe("section deduplication", () => {
    test("should return deduplicated section IDs", async () => {
      const result = await evaluateTool({
        code: "[1].map(x => x).map(x => x)",
      });

      expect(result.error).toBeUndefined();

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

  // #endregion

  // #region Edge cases

  describe("edge cases", () => {
    test("should handle empty code", async () => {
      const result = await evaluateTool({ code: "" });

      expect(result).toBeDefined();
      // Empty code should either succeed with empty sections or error
      expect(
        result.error !== undefined ||
          (result.importantSections !== undefined &&
            result.otherSections !== undefined),
      ).toBe(true);
    });

    test("should handle whitespace-only code", async () => {
      const result = await evaluateTool({ code: "   \n\n  \t  " });

      expect(result).toBeDefined();
    });

    test("should handle code with comments only", async () => {
      const result = await evaluateTool({
        code: "// this is a comment\n/* another comment */",
      });

      expect(result).toBeDefined();
    });

    test("should handle large code (>500 chars)", async () => {
      const largeCode = `const arr = [${Array.from(
        { length: 200 },
        (_, i) => i,
      ).join(", ")}]; arr.length;`;

      expect(largeCode.length).toBeGreaterThan(500);

      const result = await evaluateTool({ code: largeCode });

      expect(result.error).toBeUndefined();
    });

    test("should handle nested function calls", async () => {
      const result = await evaluateTool({
        code: "[1, [2, [3]]].flat(2)",
      });

      expect(result.error).toBeUndefined();
    });
  });

  // #endregion

  // #region Tool metadata

  describe("tool metadata", () => {
    test("should export correct tool name", () => {
      expect(evaluateToolName).toBe("ask262_evaluate_in_engine262");
    });

    test("should export input and output schemas", () => {
      expect(evaluateInputSchema).toBeDefined();
      expect(evaluateOutputSchema).toBeDefined();
    });
  });

  // #endregion
});
