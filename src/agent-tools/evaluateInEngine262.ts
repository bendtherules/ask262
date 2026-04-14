/**
 * Evaluate JavaScript code in engine262 and capture spec section marks.
 * Executes code in the engine262 JavaScript engine and returns the captured
 * ECMAScript spec section marks.
 */

import { z } from "zod";

// #region Zod schemas (not exported)

const consoleEntrySchema = z.object({
  method: z.string().describe("Console method name (log, warn, debug, error)"),
  values: z.array(z.unknown()).describe("Values logged to console"),
});

const evaluateSuccessOutputSchema = z.object({
  importantSections: z
    .array(z.string())
    .describe("Important spec sections hit during execution"),
  otherSections: z
    .array(z.string())
    .describe("Other spec sections hit during execution"),
  consoleOutput: z
    .array(consoleEntrySchema)
    .describe("Console output captured during execution"),
  error: z.undefined().optional(),
});

const evaluateErrorOutputSchema = z.object({
  importantSections: z.undefined().optional(),
  otherSections: z.undefined().optional(),
  consoleOutput: z.undefined().optional(),
  error: z.string().describe("Error message when execution fails"),
});

// Combined output schema (single object with optional fields because MCP SDK doesn't accept union schemas)
const evaluateOutputSchemaCombined = z.object({
  importantSections: z
    .array(z.string())
    .optional()
    .describe("Important spec sections hit during execution (absent on error)"),
  otherSections: z
    .array(z.string())
    .optional()
    .describe("Other spec sections hit during execution (absent on error)"),
  consoleOutput: z
    .array(consoleEntrySchema)
    .optional()
    .describe("Console output captured during execution (absent on error)"),
  error: z.string().optional().describe("Error message when execution fails"),
});

// #endregion

// #region Exported Zod schemas

/**
 * Tool metadata for reuse in OpenCode tools.
 */
export const toolMetadata = {
  description:
    "Executes pure ECMAScript JavaScript code in the engine262 JavaScript engine and captures which ECMAScript specification sections are hit during execution. " +
    "Returns an object with importantSections, otherSections, and consoleOutput arrays. Useful for understanding how specific JavaScript operations map to the ECMAScript spec. " +
    "Code must be pure ECMAScript with no DOM, browser, or Node.js APIs (no fs, document, window, etc.). " +
    "console object with log/warn/debug/error methods and ask262Debug are available globally (no import needed). " +
    "Use ask262Debug.startImportant() and ask262Debug.stopImportant() to mark important sections. " +
    "Example: console.log('test'); ask262Debug.startImportant(); let x = 1 + 2; ask262Debug.stopImportant();",
  args: {
    code: "JavaScript code to execute in engine262 (e.g., 'console.log([1,2,3].map(x => x * 2))')",
  },
};

/**
 * Input schema for the evaluate tool.
 */
export const inputSchema = z.object({
  code: z.string().describe(toolMetadata.args.code),
});

/**
 * Output schema for the evaluate tool.
 * Uses a single object schema with optional fields for MCP SDK compatibility
 * (MCP SDK doesn't support union schemas in outputSchema).
 */
export const outputSchema = evaluateOutputSchemaCombined;

// #endregion

// #region TypeScript types (inferred from Zod schemas)

export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;

export type EvaluateSuccessOutput = z.infer<typeof evaluateSuccessOutputSchema>;

export type EvaluateErrorOutput = z.infer<typeof evaluateErrorOutputSchema>;

/** Combined tool output type (success or error) */
export type EvaluateToolOutput = EvaluateSuccessOutput | EvaluateErrorOutput;

export type EvaluateToolInput = z.infer<typeof inputSchema>;

// #endregion

/**
 * Tool name constant.
 */
export const toolName = "ask262_evaluate_in_engine262";

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
 * Creates the evaluateInEngine262 tool function.
 * Executes JavaScript code in engine262 and captures spec section marks.
 * @returns Function that executes code and returns structured output
 */
export function createEvaluateInEngine262Tool() {
  return async ({ code }: EvaluateToolInput): Promise<EvaluateToolOutput> => {
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

    // TODO: Add reset method, allow making instances and use that.
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
        CreateDataProperty(realm.GlobalObject, Value("ask262Debug"), debugObj),
      );

      const startImportant = CreateBuiltinFunction(
        () => {
          ask262Debug.startImportant();
          // biome-ignore lint/suspicious/noExplicitAny: engine262 uses custom value types
          return (Value as any)("undefined");
        },
        0,
        Value("startImportant"),
        [],
      );
      skipDebugger(
        CreateDataProperty(debugObj, Value("startImportant"), startImportant),
      );

      const stopImportant = CreateBuiltinFunction(
        () => {
          ask262Debug.stopImportant();
          // biome-ignore lint/suspicious/noExplicitAny: engine262 uses custom value types
          return (Value as any)("undefined");
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
        CreateDataProperty(realm.GlobalObject, Value("console"), consoleObj),
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
            // biome-ignore lint/suspicious/noExplicitAny: engine262 uses custom value types
            return (Value as any)("undefined");
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
    const completion = realm.evaluateScript(code);

    // Stop tracing
    ask262Debug.stopTrace();

    // Check for error completion (engine262 returns ThrowCompletion_ instead of throwing)
    // biome-ignore lint/suspicious/noExplicitAny: engine262 internal completion types
    const completionAny = completion as any;
    if (completionAny?.Type === "throw") {
      const errorValue = completionAny.Value;
      // Extract error message from ErrorData property
      const errorMessage: string =
        errorValue?.ErrorData?.stringValue?.() ||
        errorValue?.ErrorData?.value ||
        "Unknown error";
      return {
        error: errorMessage,
      };
    }

    // Get captured marks
    const marks = ask262Debug.marks;

    // Filter and group marks by important flag
    const importantMarks = marks.filter((m) => m.important);
    const otherMarks = marks.filter((m) => !m.important);

    // Flatten sectionIds from all marks
    return {
      importantSections: importantMarks.flatMap((m) => m.sectionIds),
      otherSections: otherMarks.flatMap((m) => m.sectionIds),
      consoleOutput: consoleOutput,
    };
  };
}
