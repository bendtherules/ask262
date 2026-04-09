/**
 * OpenCode custom tool: ask262_evaluate_in_engine262
 * Executes JavaScript code in the engine262 engine and captures spec sections.
 */

import { tool } from "@opencode-ai/plugin";
import {
  createEvaluateInEngine262Tool,
  toolMetadata,
} from "../../src/agent-tools/evaluateInEngine262";

export default tool({
  description: toolMetadata.description,
  args: {
    code: tool.schema.string().describe(toolMetadata.args.code),
  },
  async execute(args) {
    const { code } = args;

    // Create and execute tool (no external dependencies needed)
    const evaluateTool = createEvaluateInEngine262Tool();
    const result = await evaluateTool.func({ code });

    return result;
  },
});
