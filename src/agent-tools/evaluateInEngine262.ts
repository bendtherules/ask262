/**
 * Evaluate JavaScript code in engine262 and capture spec section marks.
 * Executes code in the engine262 JavaScript engine and returns the captured
 * ECMAScript spec section marks as JSON.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const evaluateSchema = z.object({
  code: z.string().describe("JavaScript code to execute in engine262"),
});

// Type definitions for engine262 module
interface MarkData {
  readonly sectionIds: string[];
  readonly fileRelativePath: string;
  readonly lineNumber: number;
  readonly important: boolean;
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
    description:
      "Executes JavaScript code in the engine262 JavaScript engine and captures which ECMAScript specification sections are hit during execution. Returns the full marks array as JSON. Useful for understanding how specific JavaScript operations map to the ECMAScript spec.",
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

        // Set up agent and realm
        const agent = new Agent();
        setSurroundingAgent(agent);
        const realm = new ManagedRealm();

        // Expose ask262Debug controls to the evaluated code
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
        };

        // Return compressed JSON
        return JSON.stringify(result);
      } catch (error) {
        console.error(`[Tool: ask262_evaluate_in_engine262] Error: ${error}`);
        return `Error executing code in engine262: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}
