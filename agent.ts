import fs from "node:fs";
import * as lancedbSdk from "@lancedb/lancedb";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { DynamicTool } from "@langchain/core/tools";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import Graph from "graphology";
import { AgentExecutor, createReactAgent } from "langchain/agents";

import { GRAPH_FILE, STORAGE_DIR } from "./constants";

const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text-v2-moe",
});

const config = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
const apiKey = config.NVIDIA_API_KEY;
const baseURL = config.NVIDIA_API_BASE;

if (!apiKey) {
  console.warn("Please set NVIDIA_API_KEY in config.json.");
}

const llm = new ChatOpenAI({
  modelName: "openai/gpt-oss-120b",
  openAIApiKey: apiKey,
  configuration: { baseURL },
  temperature: 0,
});

const systemPrompt = `You are an expert in the ECMAScript specification and its implementation in engine262.
Your goal is to explain how specific parts of the language work by combining information from the provided tools.

CRITICAL INSTRUCTIONS:
1. ALWAYS prefer using the provided tools ('spec_retriever', 'fetch_section_chunks', and 'graph_explorer') to answer questions.
2. Do NOT rely on your internal knowledge of JavaScript or the ECMAScript specification.
3. If the user asks about a function, you MUST first use 'graph_explorer' to find the associated specification section.
4. You MUST then use 'fetch_section_chunks' to read the actual text of that specification section before answering.
5. Base your explanations ONLY on the information retrieved from the tools.
6. If the tools do not provide enough information, state that clearly rather than guessing from your internal knowledge.`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["human", "{input}"],
]);

async function main() {
  console.log("Loading indices and graph...");

  const db = await lancedbSdk.connect(STORAGE_DIR);
  const table = await db.openTable("spec_vectors");
  const vectorStore = new LanceDB(embeddings, { table });

  const graphData = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf-8"));
  const graph = new Graph({ multi: true });
  graph.import(graphData);

  const specRetrieverTool = new DynamicTool({
    name: "spec_retriever",
    description:
      "Queries the language specification for text content about specific sections or topics. Use this to get the detailed text of a section.",
    func: async (query: string) => {
      const results = await vectorStore.similaritySearch(query, 3);
      return results.map((r) => r.pageContent).join("\n\n");
    },
  });

  const sectionRetrieverTool = new DynamicTool({
    name: "fetch_section_chunks",
    description:
      "Retrieves all text chunks from a specific specification section by sectionId. Use after finding a sectionId via spec_retriever.",
    func: async (sectionId: string) => {
      const results = await table
        .query()
        .where(`sectionid = '${sectionId}'`)
        .limit(100)
        .toArray();
      return results.map((r: { text: string }) => r.text).join("\n\n");
    },
  });

  const graphTool = new DynamicTool({
    name: "graph_explorer",
    description:
      "Explores structural relationships between specification sections and implementation code (functions). Use this to find which spec section a function implements. Input: section ID or function name.",
    func: async (query: string) => {
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
          result += `- ${neighbor} (${attr.type}) via ${edgeAttr.type}${attr.title ? `: ${attr.title}` : ""}\n`;
        });

        return result;
      }

      return `No information found in graph for ${query}. Use spec_retriever to search text.`;
    },
  });

  const agent = await createReactAgent({
    llm,
    tools: [specRetrieverTool, sectionRetrieverTool, graphTool],
    prompt,
  });

  const agentExecutor = new AgentExecutor({
    agent,
    tools: [specRetrieverTool, sectionRetrieverTool, graphTool],
  });

  console.log("Agent is ready!");

  const message =
    process.argv[2] ||
    "Which spec section does Evaluate_IfStatement implement? and what does that section say?";
  console.log(`User: ${message}`);

  const response = await agentExecutor.invoke({
    input: message,
  });

  console.log("\n--- Agent Response ---\n");
  console.log(response.output);
}

main().catch(console.error);
