/**
 * OpenCode custom tool: ask262_evaluate_in_engine262
 * Executes JavaScript code in the engine262 engine and captures spec sections.
 */

import { tool } from "@opencode-ai/plugin";
import { createEvaluateInEngine262Tool } from "../../src/agent-tools";

export default tool({
  description:
    "Executes JavaScript code in the engine262 JavaScript engine and captures which ECMAScript specification sections are hit during execution. " +
    "Returns JSON with importantSections and otherSections arrays. " +
    "Use this to understand how specific JavaScript operations map to the ECMAScript spec. " +
    "You can use ask262Debug.startImportant() and ask262Debug.stopImportant() in the code to mark important sections.",
  args: {
    code: tool.schema
      .string()
      .describe(
        "JavaScript code to execute in engine262 (e.g., '[1,2,3].map(x => x * 2)')",
      ),
  },
  async execute(args) {
    const { code } = args;

    // Create and execute tool (no external dependencies needed)
    const evaluateTool = createEvaluateInEngine262Tool();
    const result = await evaluateTool.func({ code });

    return result;
  },
});
