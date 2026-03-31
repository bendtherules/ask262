import fs from "node:fs";
import { OllamaEmbedding } from "@llamaindex/ollama";
import { OpenAI } from "@llamaindex/openai";
import Graph from "graphology";
import {
  QueryEngineTool,
  ReActAgent,
  Settings,
  storageContextFromDefaults,
  VectorStoreIndex,
} from "llamaindex";

import { GRAPH_FILE, STORAGE_DIR } from "./constants";

// Configure LlamaIndex to use local Ollama embeddings for semantic search
// This enables the query engine to perform similarity searches without external APIs
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text-v2-moe",
});

// Load API configuration from config.json
// Expects NVIDIA_API_KEY and NVIDIA_API_BASE for accessing NVIDIA's API endpoint
const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const apiKey = config.NVIDIA_API_KEY;
const baseURL = config.NVIDIA_API_BASE;

if (!apiKey) {
  console.warn("Please set NVIDIA_API_KEY in config.json.");
}

// Initialize the LLM using NVIDIA's OpenAI-compatible API endpoint
// Model: openai/gpt-oss-120b with temperature 0 for deterministic responses
const llm = new OpenAI({
  model: "openai/gpt-oss-120b",
  apiKey: apiKey,
  baseURL: baseURL,
  temperature: 0,
});
Settings.llm = llm;

/**
 * Main function that initializes and runs the ECMAScript specification agent.
 *
 * The agent combines two information sources:
 * 1. Vector search index (spec_retriever) - for semantic text search across spec sections
 * 2. Graph knowledge base (graph_explorer) - for structural relationships between sections and code
 */
async function main() {
  console.log("Loading indices and graph...");

  // Load the vector index from disk containing embedded spec sections
  const storageContext = await storageContextFromDefaults({
    persistDir: STORAGE_DIR,
  });

  const index = await VectorStoreIndex.init({
    storageContext,
  });

  // Load the knowledge graph mapping spec sections to implementation functions
  const graphData = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
  const graph = new Graph({ multi: true });
  graph.import(graphData);

  // Create a query engine with top-3 similarity results for text retrieval
  const queryEngine = index.asQueryEngine({ similarityTopK: 3 });

  /**
   * Tool for retrieving specification text via vector similarity search.
   * Used to get detailed content of specific sections based on semantic queries.
   */
  const queryEngineTool = new QueryEngineTool({
    queryEngine,
    metadata: {
      name: "spec_retriever",
      description:
        "Queries the language specification for text content about specific sections or topics. Use this to get the detailed text of a section.",
    },
  });

  /**
   * Tool for exploring the knowledge graph connecting spec sections to implementation.
   * Enables structural navigation: finding which spec section a function implements
   * or which functions implement a spec section.
   */
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
    call: async ({ query }: { query: string }) => {
      console.log(`[Tool: graph_explorer] Querying for: ${query}`);

      // Try exact node match, or prepend 'func-' prefix for function names
      let nodeId = query;
      if (!graph.hasNode(nodeId)) {
        if (graph.hasNode(`func-${query}`)) {
          nodeId = `func-${query}`;
        }
      }

      if (graph.hasNode(nodeId)) {
        // Collect node info and all connected nodes
        const neighbors = graph.neighbors(nodeId);
        const nodeAttr = graph.getNodeAttributes(nodeId);

        let result = `Information for ${nodeId} (${nodeAttr.type}):\n`;
        if (nodeAttr.title) result += `- Title: ${nodeAttr.title}\n`;
        if (nodeAttr.file) result += `- File: ${nodeAttr.file}\n`;
        result += `\nConnected parts:\n`;

        // List all connected nodes with their relationship types
        neighbors.forEach((neighbor) => {
          const attr = graph.getNodeAttributes(neighbor);
          const edges = graph.edges(nodeId, neighbor);
          const edgeAttr = graph.getEdgeAttributes(edges[0]);
          result += `- ${neighbor} (${attr.type}) via ${edgeAttr.type}${attr.title ? `: ${attr.title}` : ""}\n`;
        });

        return result;
      }

      return `No information found in graph for ${query}. Use spec_retriever to search text.`;
    },
  };

  /**
   * ReAct agent that reasons about ECMAScript specification.
   *
   * The agent follows this workflow:
   * 1. For function queries: graph_explorer → spec_retriever → explanation
   * 2. For section queries: spec_retriever → explanation
   *
   * Critical constraints ensure tool-based answers rather than internal knowledge.
   */
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

  // Accept user query from command line argument, or use default question
  const message =
    process.argv[2] ||
    "Which spec section does Evaluate_IfStatement implement? and what does that section say?";
  console.log(`User: ${message}`);

  // Execute the agent with the user's query
  const response = await agent.chat({
    message: message,
  });

  console.log("\n--- Agent Response ---\n");
  console.log(response.toString());
}

main().catch(console.error);
