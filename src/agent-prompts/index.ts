/**
 * Agent prompts index for ask262 MCP server.
 * Exports all available prompts with proper naming conventions.
 */

export {
  createPrompt as createAskPrompt,
  promptArgsSchema as askPromptArgsSchema,
  promptMetadata as askPromptMetadata,
} from "./ask.js";
