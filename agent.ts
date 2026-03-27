import fs from "node:fs";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
  Settings,
  QueryEngineTool,
  ReActAgent,
} from "llamaindex";
import { OllamaEmbedding } from "@llamaindex/ollama";
import { OpenAI } from "@llamaindex/openai";
import { Graph } from "graphology";

import { STORAGE_DIR, GRAPH_FILE } from "./constants.ts";

// Configure Settings
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text-v2-moe",
});

const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const apiKey = config.NVIDIA_API_KEY;
const baseURL = config.NVIDIA_API_BASE;

if (!apiKey) {
  console.warn("Please set NVIDIA_API_KEY in config.json.");
}

const llm = new OpenAI({
  model: "openai/gpt-oss-120b",
  apiKey: apiKey,
  baseURL: baseURL,
  temperature: 0,
});
Settings.llm = llm;

async function main() {
  console.log("Loading indices and graph...");
  const storageContext = await storageContextFromDefaults({
    persistDir: STORAGE_DIR,
  });

  const index = await VectorStoreIndex.init({
    storageContext,
  });

  const graphData = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
  const graph = new Graph({ multi: true });
  graph.import(graphData);

  const queryEngine = index.asQueryEngine({ similarityTopK: 3 });

  const queryEngineTool = new QueryEngineTool({
    queryEngine,
    metadata: {
      name: "spec_retriever",
      description:
        "Queries the language specification for text content about specific sections or topics. Use this to get the detailed text of a section.",
    },
  });

  const graphTool = {
    metadata: {
      name: "graph_explorer",
      description:
        "Explores structural relationships between specification sections and implementation code (functions). Use this to find which spec section a function implements. Input: section ID or function name.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The section ID or function name to explore.",
          },
        },
        required: ["query"],
      },
    },
    call: async ({ query }) => {
      console.log(`[Tool: graph_explorer] Querying for: ${query}`);
      let nodeId = query;
      if (!graph.hasNode(nodeId)) {
        if (graph.hasNode(`func-${query}`)) {
          nodeId = `func-${query}`;
        }
      }

      if (graph.hasNode(nodeId)) {
        const neighbors = graph.neighbors(nodeId);
        const nodeAttr = graph.getNodeAttributes(nodeId);
        let result = `Information for ${nodeId} (${nodeAttr.type}):\n`;
        if (nodeAttr.title) result += `- Title: ${nodeAttr.title}\n`;
        if (nodeAttr.file) result += `- File: ${nodeAttr.file}\n`;
        result += `\nConnected parts:\n`;
        neighbors.forEach((neighbor) => {
          const attr = graph.getNodeAttributes(neighbor);
          const edges = graph.edges(nodeId, neighbor);
          const edgeAttr = graph.getEdgeAttributes(edges[0]);
          result += `- ${neighbor} (${attr.type}) via ${edgeAttr.type}${attr.title ? ": " + attr.title : ""}\n`;
        });
        return result;
      }
      return `No information found in graph for ${query}. Use spec_retriever to search text.`;
    },
  };

  const agent = new ReActAgent({
    tools: [queryEngineTool, graphTool],
    llm: llm,
    verbose: true,
    systemPrompt: `You are an expert in the ECMAScript specification and its implementation in engine262.
Your goal is to explain how specific parts of the language work by combining information from the provided tools.

CRITICAL INSTRUCTIONS:
1. ALWAYS prefer using the provided tools ('spec_retriever' and 'graph_explorer') to answer questions.
2. Do NOT rely on your internal knowledge of JavaScript or the ECMAScript specification.
3. If the user asks about a function, you MUST first use 'graph_explorer' to find the associated specification section.
4. You MUST then use 'spec_retriever' to read the actual text of that specification section before answering.
5. Base your explanations ONLY on the information retrieved from the tools.
6. If the tools do not provide enough information, state that clearly rather than guessing from your internal knowledge.`,
  });

  console.log("Agent is ready!");

  const message =
    process.argv[2] ||
    "Which spec section does Evaluate_IfStatement implement? and what does that section say?";
  console.log(`User: ${message}`);

  const response = await agent.chat({
    message: message,
  });

  console.log("\n--- Agent Response ---\n");
  console.log(response.toString());
}

main().catch(console.error);
