/**
 * Evaluate JavaScript code in engine262 and capture spec section marks.
 * Executes code in the engine262 JavaScript engine and returns the captured
 * ECMAScript spec section marks.
 * Uses child_process for true isolation and guaranteed termination via SIGKILL.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LogOperation, logger } from "../lib/logger.js";
import { withSpan } from "../lib/tracing.js";

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
    "Executes pure JavaScript code in the engine262 JavaScript engine and captures which ECMAScript specification sections are hit during execution. " +
    "Returns an object with importantSections, otherSections, and consoleOutput arrays." +
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

/**
 * Default timeout for code execution
 */
const DEFAULT_EXECUTION_TIMEOUT_MS = 1000;

/**
 * Execute JavaScript code in engine262 using a child process.
 * @param code - JavaScript code to execute
 * @param timeoutMs - Maximum execution time in milliseconds
 * @returns Execution result as JSON string
 */
function executeInChildProcess(
  code: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    // Get the runner script path
    const runnerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "evaluateInEngine262.runner.mjs",
    );

    // Spawn child process using Bun
    const child = spawn("bun", [runnerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      killSignal: "SIGKILL", // Force kill, can't be blocked
    });

    let stdout = "";
    let stderr = "";

    // Collect stdout
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr (for errors)
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Set up timeout
    let killedByTimeout = false;
    const timeoutId = setTimeout(() => {
      killedByTimeout = true;
      // SIGKILL can't be caught or blocked - guaranteed termination
      child.kill("SIGKILL");
    }, timeoutMs);

    // Handle process exit
    child.on("close", (code, signal) => {
      // Clear timeout
      clearTimeout(timeoutId);

      if (signal === "SIGKILL" || signal === "SIGTERM") {
        // Process was killed (timeout or error)
        if (killedByTimeout) {
          resolve(
            JSON.stringify({
              error: `Execution timeout after ${timeoutMs}ms`,
            }),
          );
        } else {
          resolve(
            JSON.stringify({
              error: stderr || "Process terminated",
            }),
          );
        }
        return;
      }

      if (code !== 0) {
        resolve(
          JSON.stringify({
            error: stderr || `Process exited with code ${code}`,
          }),
        );
        return;
      }

      // Success - return stdout (should be JSON result)
      try {
        // Validate it's valid JSON
        JSON.parse(stdout);
        resolve(stdout);
      } catch {
        resolve(
          JSON.stringify({
            error: `Invalid output: ${stdout.slice(0, 200)}`,
          }),
        );
      }
    });

    // Handle spawn errors
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve(
        JSON.stringify({
          error: `Failed to spawn process: ${error.message}`,
        }),
      );
    });

    // Send code to child via stdin
    child.stdin?.write(code);
    child.stdin?.end();
  });
}

/**
 * Creates the evaluateInEngine262 tool function.
 * Executes JavaScript code in engine262 using a child process with timeout support.
 * Uses child_process for true isolation and guaranteed termination via SIGKILL.
 * @param timeoutMs - Maximum execution time in milliseconds
 * @returns Function that executes code and returns structured output
 */
export function createEvaluateInEngine262Tool(
  timeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
) {
  return async ({ code }: EvaluateToolInput): Promise<EvaluateToolOutput> => {
    const log = await logger.forComponent("engine262-runner");

    log.info(LogOperation.EVALUATE_IN_ENGINE262, { code_length: code.length });

    // Truncate code for logging if too long (>500 chars)
    const codeForLog =
      code.length > 500
        ? `${code.substring(0, 500)}... (${code.length - 500} more chars)`
        : code;

    // Only the main evaluating_in_engine262 span logs the full code
    return await withSpan(
      LogOperation.EVALUATING_IN_ENGINE262,
      { code: codeForLog, code_length: code.length, timeout_ms: timeoutMs },
      async () => {
        const op = log.start(LogOperation.EVALUATING_IN_ENGINE262, {
          code: codeForLog,
          code_length: code.length,
          timeout_ms: timeoutMs,
        });

        try {
          // Child operations don't need to log the code - it's in the parent span context
          log.debug(LogOperation.SPAWNING_CHILD_PROCESS, {
            timeout_ms: timeoutMs,
          });

          // Execute code in isolated child process
          const resultJson = await executeInChildProcess(code, timeoutMs);

          // Parse the result
          const result = JSON.parse(resultJson) as EvaluateToolOutput;

          if ("error" in result && result.error) {
            log.warn(LogOperation.ENGINE262_ABRUPT_COMPLETION, {
              error: result.error,
            });
            op.end({ status: "error", error: result.error });
          } else {
            const successResult = result as EvaluateSuccessOutput;
            // op.end logs the final completion with all metrics and duration
            op.end({
              status: "success",
              important_sections: successResult.importantSections.length,
              other_sections: successResult.otherSections.length,
              console_entries: successResult.consoleOutput.length,
            });
          }

          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          log.error(
            LogOperation.EVALUATING_IN_ENGINE262,
            { code_length: code.length },
            error,
          );
          op.end({ status: "exception", error: error.message });
          return {
            error: error.message,
          };
        }
      },
    );
  };
}
