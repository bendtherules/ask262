/**
 * Graph explorer tool.
 * Explores structural relationships between specification sections and implementation code.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type Graph from "graphology";
import { z } from "zod";
import { LogOperation, logger } from "../lib/logger.js";
import { withSpan } from "../lib/tracing.js";

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
// @ts-expect-error - Graph type issue
export function createGraphExplorerTool(graph: Graph) {
  return new DynamicStructuredTool({
    name: "ask262_graph_explorer",
    description:
      "Explores structural relationships between specification sections and implementation code (functions). Use this to find which spec section a function implements.",
    schema: graphExplorerSchema,
    func: async ({ query }) => {
      const log = await logger.forComponent("graph-explorer");

      log.info(LogOperation.EXPLORING_GRAPH, { query });

      return await withSpan(
        LogOperation.EXPLORING_GRAPH,
        { query },
        async () => {
          const op = log.start(LogOperation.EXPLORING_GRAPH, { query });

          let nodeId = query;
          if (!graph.hasNode(nodeId)) {
            if (graph.hasNode(`func-${query}`)) {
              nodeId = `func-${query}`;
              log.debug(LogOperation.RESOLVING_NODE_ID, {
                original: query,
                resolved: nodeId,
              });
            }
          }

          if (graph.hasNode(nodeId)) {
            const neighbors = graph.neighbors(nodeId);
            const nodeAttr = graph.getNodeAttributes(nodeId);

            log.debug(LogOperation.NODE_FOUND, {
              node_id: nodeId,
              type: nodeAttr.type,
              neighbor_count: neighbors.length,
            });

            let result = `Information for ${nodeId} (${nodeAttr.type}):\n`;
            if (nodeAttr.title) result += `- Title: ${nodeAttr.title}\n`;
            if (nodeAttr.file) result += `- File: ${nodeAttr.file}\n`;
            result += `\nConnected parts:\n`;

            neighbors.forEach((neighbor: string) => {
              const attr = graph.getNodeAttributes(neighbor);
              const edges = graph.edges(nodeId, neighbor);
              const edgeAttr = graph.getEdgeAttributes(edges[0]);
              result += `- ${neighbor} (${attr.type}) via ${edgeAttr.type}${attr.title ? `: ${attr.title}` : ""}\n`;
            });

            op.end({
              status: "found",
              node_id: nodeId,
              type: nodeAttr.type,
              neighbor_count: neighbors.length,
            });

            return result;
          }

          log.warn(LogOperation.NODE_NOT_FOUND, {
            query,
            attempted_id: nodeId,
          });
          op.end({ status: "not_found", query });

          return `No information found in graph for ${query}. Use ask262_search_spec_sections to search text.`;
        },
      );
    },
  });
}
