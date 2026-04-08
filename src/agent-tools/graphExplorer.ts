/**
 * Graph explorer tool.
 * Explores structural relationships between specification sections and implementation code.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type Graph from "graphology";
import { z } from "zod";

const graphExplorerSchema = z.object({
  query: z
    .string()
    .describe(
      "The section ID or function name to explore in the graph (e.g., 'Evaluate_IfStatement' or 'sec-if-statement')",
    ),
});

/**
 * Creates the graph explorer tool.
 * @param graph - Graphology graph instance
 */
export function createGraphExplorerTool(graph: Graph) {
  return new DynamicStructuredTool({
    name: "graph_explorer",
    description:
      "Explores structural relationships between specification sections and implementation code (functions). Use this to find which spec section a function implements.",
    schema: graphExplorerSchema,
    func: async ({ query }) => {
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
}
