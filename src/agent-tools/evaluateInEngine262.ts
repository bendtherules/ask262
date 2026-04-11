/**
 * Evaluate JavaScript code in engine262 and capture spec section marks.
 * Executes code in the engine262 JavaScript engine and returns the captured
 * ECMAScript spec section marks as JSON.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Tool metadata for reuse in OpenCode tools.
 */
export const toolMetadata = {
  description:
    "Executes pure ECMAScript JavaScript code in the engine262 JavaScript engine and captures which ECMAScript specification sections are hit during execution. " +
    "Returns JSON with importantSections, otherSections, and consoleOutput arrays. Useful for understanding how specific JavaScript operations map to the ECMAScript spec. " +
    "Code must be pure ECMAScript with no DOM, browser, or Node.js APIs (no fs, document, window, etc.). " +
    "console object with log/warn/debug/error methods and ask262Debug are available globally (no import needed). " +
    "Use ask262Debug.startImportant() and ask262Debug.stopImportant() to mark important sections. " +
    "Example: console.log('test'); ask262Debug.startImportant(); let x = 1 + 2; ask262Debug.stopImportant();",
  args: {
    code: "JavaScript code to execute in engine262 (e.g., 'console.log([1,2,3].map(x => x * 2))')",
  },
};

const evaluateSchema = z.object({
  code: z.string().describe(toolMetadata.args.code),
});

// Type definitions for engine262 module
interface MarkData {
  readonly sectionIds: string[];
  readonly fileRelativePath: string;
  readonly lineNumber: number;
  readonly important: boolean;
}

// Console log entry type
interface ConsoleEntry {
  method: string;
  values: unknown[];
}

// biome-ignore lint/suspicious/noExplicitAny: engine262 is an external module without TypeScript types
let engine262Module: any = null;

/**
 * Lazy load engine262 module
 */
async function loadEngine262() {
  if (!engine262Module) {
    // Dynamic import of engine262 from local path
    engine262Module = await import("../../engine262/lib/engine262.mjs");
  }
  return engine262Module;
}

/**
 * Creates the evaluateInEngine262 tool.
 * Executes JavaScript code in engine262 and captures spec section marks.
 * @returns The evaluate_in_engine262 tool instance
 */
export function createEvaluateInEngine262Tool() {
  return new DynamicStructuredTool({
    name: "ask262_evaluate_in_engine262",
    description: toolMetadata.description,
    schema: evaluateSchema,
    func: async ({ code }) => {
      try {
        const engine = await loadEngine262();
        const ask262Debug = engine.ask262Debug as {
          marks: MarkData[];
          startTrace: () => void;
          stopTrace: () => void;
          startImportant: () => void;
          stopImportant: () => void;
        };
        const Agent = engine.Agent;
        const ManagedRealm = engine.ManagedRealm;
        const setSurroundingAgent = engine.setSurroundingAgent;
        const OrdinaryObjectCreate = engine.OrdinaryObjectCreate;
        const CreateBuiltinFunction = engine.CreateBuiltinFunction;
        const CreateDataProperty = engine.CreateDataProperty;
        const Value = engine.Value;
        const skipDebugger = engine.skipDebugger;

        // Reset marks from previous runs
        ask262Debug.marks = [];

        // Array to capture console output
        const consoleOutput: ConsoleEntry[] = [];

        // Set up agent and realm
        const agent = new Agent();
        setSurroundingAgent(agent);
        const realm = new ManagedRealm();

        // Expose ask262Debug and console to the evaluated code
        realm.scope(() => {
          const debugObj = OrdinaryObjectCreate(
            agent.intrinsic("%Object.prototype%"),
          );
          skipDebugger(
            CreateDataProperty(
              realm.GlobalObject,
              Value("ask262Debug"),
              debugObj,
            ),
          );

          const startImportant = CreateBuiltinFunction(
            () => {
              ask262Debug.startImportant();
              return Value.undefined;
            },
            0,
            Value("startImportant"),
            [],
          );
          skipDebugger(
            CreateDataProperty(
              debugObj,
              Value("startImportant"),
              startImportant,
            ),
          );

          const stopImportant = CreateBuiltinFunction(
            () => {
              ask262Debug.stopImportant();
              return Value.undefined;
            },
            0,
            Value("stopImportant"),
            [],
          );
          skipDebugger(
            CreateDataProperty(debugObj, Value("stopImportant"), stopImportant),
          );

          // Create console object with methods (excluding 'clear')
          const consoleObj = OrdinaryObjectCreate(
            agent.intrinsic("%Object.prototype%"),
          );
          skipDebugger(
            CreateDataProperty(
              realm.GlobalObject,
              Value("console"),
              consoleObj,
            ),
          );

          // Add console methods: log, warn, debug, error
          const consoleMethods = ["log", "warn", "debug", "error"];
          for (const method of consoleMethods) {
            const fn = CreateBuiltinFunction(
              (args: unknown[]) => {
                // Convert engine262 values to JavaScript values for the output
                const jsValues = args.map((arg) => {
                  // Handle engine262 Value types - convert to primitive JS values
                  if (arg && typeof arg === "object") {
                    // Try to get string value if it's a JSStringValue
                    const strVal = (arg as { stringValue?: () => string })
                      .stringValue;
                    if (typeof strVal === "function") {
                      return strVal.call(arg);
                    }
                    // Try other common properties
                    const value = (arg as { value?: unknown }).value;
                    if (value !== undefined) {
                      return value;
                    }
                  }
                  return arg;
                });
                consoleOutput.push({ method, values: jsValues });
                return Value.undefined;
              },
              1,
              Value(method),
              [],
            );
            skipDebugger(CreateDataProperty(consoleObj, Value(method), fn));
          }
        });

        // Start tracing
        ask262Debug.startTrace();

        // Execute the code
        realm.evaluateScript(code);

        // Stop tracing
        ask262Debug.stopTrace();

        // Get captured marks
        const marks = ask262Debug.marks;

        // Filter and group marks by important flag
        const importantMarks = marks.filter((m) => m.important);
        const otherMarks = marks.filter((m) => !m.important);

        // Extract sectionIds, remove fileRelativePath and lineNumber
        const result = {
          importantSections: importantMarks.map((m) => m.sectionIds),
          otherSections: otherMarks.map((m) => m.sectionIds),
          consoleOutput: consoleOutput,
        };

        // Return compressed JSON
        return JSON.stringify(result);
      } catch (error) {
        console.error(`[Tool: ask262_evaluate_in_engine262] Error: ${error}`);
        const errorResult = {
          error: error instanceof Error ? error.message : String(error),
        };
        return JSON.stringify(errorResult);
      }
    },
  });
}
