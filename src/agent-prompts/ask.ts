/**
 * Ask prompt for ask262 MCP server.
 * Provides tool orchestration guidance for exploring ECMAScript spec.
 *
 * File name: ask.ts -> Prompt name: "ask"
 */

import { z } from "zod";

/**
 * Arguments schema for the prompt.
 */
export const promptArgsSchema = {
  question: z.string().describe("Question"),
};

/**
 * Creates the prompt messages for tool orchestration guidance.
 * @param question - The user's question to include in the prompt
 * @returns Prompt content with user message and assistant orchestration guide
 */
export function createPrompt(question: string) {
  return {
    description: "Ask262 orchestration guide",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: question,
        },
      },
      {
        role: "assistant" as const,
        content: {
          type: "text" as const,
          text: `I'll help you understand this from the ECMAScript specification using ask262 tools.

Available tools:
- ask262_search_spec_sections: Vector search to find relevant spec section ids
- ask262_get_section_content: Retrieve full text from a spec section id  
- ask262_evaluate_in_engine262: Execute pure JS and capture which spec section ids are hit. Has 1-second timeout for safety.

I'll use one of these orchestration patterns:

PATTERN 1 - For "What happens when I run this code?" questions:
   - Use ask262Debug.startImportant() and ask262Debug.stopImportant() in the code to mark only important sections.
   - STEP 1: ask262_evaluate_in_engine262(code: markedCode)
   - STEP 2: ask262_get_section_content(sectionIds: ["sec-1", "sec-2"], recursive: true)
   - Explain which spec sections were hit and why

PATTERN 2 - For "How does X work?" questions:
   - Flow A: Generate a specific code example and follow Pattern 1
   - Flow B: If no code example possible, search broadly:
     * STEP 1: ask262_search_spec_sections(query: "<relevant keywords>")
     * STEP 2: ask262_get_section_content(sectionIds: ["sec-1", "sec-2"], recursive: true)

I prefer Pattern 1 when possible as it provides exact spec sections through execution.

Example - How inserting to array works?
- Maps to Pattern 2, Flow A:
- I'll generate this code:
  \`\`\`
   let arr = [];
   ask262Debug.startImportant();
   arr.push(1);
   ask262Debug.stopImportant();
   console.log(arr);
   console.log(arr.length);
  \`\`\`
- I'll run it through ask262_evaluate_in_engine262 to find important sections
- I'll get content for some of those sections with ask262_get_section_content
- I'll explain which sections were hit and how they relate to Array.prototype.push and length property

Key principles:
- Ignore internal knowledge about Javascript/ECMAScript - rely only on spec sections from tools
- Reference specific spec sections either by section id (sec-array.prototype.map) or number+name (e.g., "23.1.3.21 Array.prototype.map")
- If I can't generate a relevant code example, I'll ask you to provide one`,
        },
      },
    ],
  };
}

/**
 * Metadata for the prompt.
 */
export const promptMetadata = {
  description:
    "Explains JavaScript internals from the ECMAScript specification.",
  argsSchema: promptArgsSchema,
};
