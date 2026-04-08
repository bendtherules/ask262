import fs from "node:fs";
import * as lancedbSdk from "@lancedb/lancedb";
import { LanceDB } from "@langchain/community/vectorstores/lancedb";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import Graph from "graphology";
import { AgentExecutor, createReactAgent } from "langchain/agents";
import {
  createGraphExplorerTool,
  createSectionRetrieverTool,
  createSpecRetrieverTool,
} from "./agent-tools";
import {
  CONFIG_FILE,
  EMBEDDING_MODEL,
  GRAPH_FILE,
  STORAGE_DIR,
} from "./constants";

const embeddings = new OllamaEmbeddings({
  model: EMBEDDING_MODEL,
});

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
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

Available tools: {tool_names}
{tools}

CRITICAL INSTRUCTIONS:
1. ALWAYS prefer using the provided tools ('spec_retriever', 'fetch_section_chunks', and 'graph_explorer') to answer questions.
2. Do NOT rely on your internal knowledge of JavaScript or the ECMAScript specification.
3. If the user asks about a function, you MUST first use 'graph_explorer' to find the associated specification section.
4. You MUST then use 'fetch_section_chunks' to read the actual text of that specification section before answering.
5. Base your explanations ONLY on the information retrieved from the tools.
6. If the tools do not provide enough information, state that clearly rather than guessing from your internal knowledge.

{agent_scratchpad}`;

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

  // Create tools using factory functions
  const specRetrieverTool = createSpecRetrieverTool(table, embeddings);
  const sectionRetrieverTool = createSectionRetrieverTool(table);
  const graphTool = createGraphExplorerTool(graph);

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
