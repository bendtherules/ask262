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
  model: "qwen3-embedding:0.6b",
});

const RERANKER_MODEL = "dengcao/Qwen3-Reranker-0.6B";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

async function rerankDocuments<T extends { pageContent: string }>(
  query: string,
  documents: T[],
): Promise<{ document: T; score: number; index: number }[]> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: RERANKER_MODEL,
        query: query,
        documents: documents.map((d) => d.pageContent),
      }),
    });

    if (!response.ok) {
      console.warn(
        `Reranker API failed: ${response.statusText}. Returning all documents.`,
      );
      return documents.map((doc, i) => ({
        document: doc,
        score: 1.0,
        index: i,
      }));
    }

    const data = await response.json();
    if (!data.results || !Array.isArray(data.results)) {
      return documents.map((doc, i) => ({
        document: doc,
        score: 1.0,
        index: i,
      }));
    }

    return data.results.map(
      (result: { index: number; relevance_score: number }) => ({
        document: documents[result.index],
        score: result.relevance_score,
        index: result.index,
      }),
    );
  } catch (error) {
    console.warn(`Reranker error: ${error}. Returning all documents.`);
    return documents.map((doc, i) => ({ document: doc, score: 1.0, index: i }));
  }
}

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
      "Queries the language specification for text content about specific sections or topics. Fetches up to 10 initial matches and uses a reranker to dynamically select the most relevant 3-5 documents based on query relevance.",
    func: async (query: string) => {
      // Fetch more documents initially with full metadata
      const initialResults = await vectorStore.similaritySearch(query, 10);

      // Create document objects with metadata
      const documents = initialResults.map((r) => ({
        pageContent: r.pageContent,
        metadata: r.metadata,
      }));

      // Rerank documents
      const reranked = await rerankDocuments(query, documents);

      // Sort by score and filter to most relevant
      reranked.sort((a, b) => b.score - a.score);

      // Dynamic selection: take top documents with score > 0.5, or at least top 3
      const threshold = 0.5;
      const minDocs = 3;
      const maxDocs = 5;

      const selected = reranked.filter(
        (r, i) => i < minDocs || (i < maxDocs && r.score > threshold),
      );

      console.log(
        `[spec_retriever] Query: "${query.slice(0, 50)}..." - Fetched ${documents.length}, reranked to ${selected.length} (scores: ${selected.map((s) => s.score.toFixed(2)).join(", ")})`,
      );

      // Return documents with metadata
      return selected
        .map((r) => {
          const meta = r.document.metadata;
          const sectionId = meta?.sectionid || "unknown";
          const sectionTitle = meta?.sectiontitle || "unknown";
          const partInfo =
            meta?.partIndex !== null && meta?.partIndex !== undefined
              ? ` [part ${(meta.partIndex as number) + 1}/${meta.totalParts}]`
              : "";
          return `--- Section: ${sectionId} | "${sectionTitle}"${partInfo} (score: ${r.score.toFixed(2)}) ---\n${r.document.pageContent}`;
        })
        .join("\n\n");
    },
  });

  const sectionRetrieverTool = new DynamicTool({
    name: "fetch_section_chunks",
    description:
      "Retrieves all text chunks from a specific specification section by sectionid. " +
      "Supports recursive fetching - if a section has children, it will fetch all descendants. " +
      "Use this to get complete content when you see 'Subsection available' or 'partial section' references.",
    func: async (sectionId: string) => {
      const allDocs: string[] = [];
      const queue: string[] = [sectionId];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const results = await table
          .query()
          .where(`sectionid = '${currentId}'`)
          .limit(100)
          .toArray();

        // Sort by partIndex to maintain order (nulls last for single-part sections)
        const sortedResults = results.sort((a: unknown, b: unknown) => {
          const aIndex = (a as { partIndex?: number }).partIndex ?? Infinity;
          const bIndex = (b as { partIndex?: number }).partIndex ?? Infinity;
          return aIndex - bIndex;
        });

        for (const result of sortedResults) {
          const typedResult = result as {
            text?: string;
            childrensectionids?: string[];
            sectiontitle?: string;
          };

          if (typedResult.text) {
            allDocs.push(typedResult.text);
          }

          // Add children to queue for recursive fetching
          if (
            typedResult.childrensectionids &&
            Array.isArray(typedResult.childrensectionids)
          ) {
            queue.push(...typedResult.childrensectionids);
          }
        }
      }

      return allDocs.join("\n\n---\n\n");
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
