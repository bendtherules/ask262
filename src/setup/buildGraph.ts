import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { glob } from "glob";
import Graph from "graphology";

// Directory containing built ECMAScript specification HTML files (ecmarkup output)
const SPEC_DIR = "./spec-built/multipage";
// Directory containing the JavaScript engine implementation source code
const CODE_DIR = "./engine262/src";

import { GRAPH_FILE } from "../constants.js";

/**
 * Builds a knowledge graph mapping ECMAScript specification sections
 * to their implementation functions in the JavaScript engine.
 *
 * The graph contains:
 * - Nodes: Spec sections and JS functions
 * - Edges: LINKS_TO (spec section references) and IMPLEMENTS (code->spec)
 */
async function buildGraph() {
  // Initialize a multi-graph (allows multiple edges between same nodes)
  // @ts-expect-error - graphology constructor type issue
  const graph = new Graph({
    multi: true,
    type: "directed",
    allowSelfLoops: false,
  });

  // Phase 1: Discover and parse specification HTML files
  const htmlFiles = await glob(path.join(SPEC_DIR, "*.html"));
  console.log(
    `Found ${htmlFiles.length} specification HTML file(s) in ${SPEC_DIR}`,
  );
  if (htmlFiles.length === 0) {
    console.warn(`Warning: No specification HTML files found in ${SPEC_DIR}`);
  }

  // Phase 2: Extract spec sections and create nodes
  console.log("Processing specification for graph...");
  for (const file of htmlFiles) {
    const fileName = path.basename(file);
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(content);
    // ecmarkup generates content within #spec-container
    const $container = $("#spec-container");

    // Each specification section is an <emu-clause> with an ID
    $container.find("emu-clause").each((_i, elem) => {
      const id = $(elem).attr("id");
      const title = $(elem).find("h1").first().text().trim();

      if (id) {
        // Create node for this spec section if not already exists
        if (!graph.hasNode(id)) {
          graph.addNode(id, { title, type: "SpecSection", file: fileName });
        }

        // Extract internal links (placeholder for potential future use)
        $(elem)
          .find("a[href]")
          .each((_j, link) => {
            const href = $(link).attr("href");
            if (href?.includes("#")) {
              const [_targetFile, targetId] = href.split("#");
              // We only care about links to other sections for now
              if (targetId?.startsWith("sec-")) {
                // Add relationship later if nodes exist
              }
            }
          });
      }
    });
  }

  // Phase 3: Create edges between spec sections based on internal links
  // This pass runs after all nodes are created to ensure target nodes exist
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(content);
    const $container = $("#spec-container");
    $container.find("emu-clause").each((_i, elem) => {
      const sourceId = $(elem).attr("id");
      if (sourceId && graph.hasNode(sourceId)) {
        $(elem)
          .find("a[href]")
          .each((_j, link) => {
            const href = $(link).attr("href");
            if (href?.includes("#")) {
              const [, targetId] = href.split("#");
              // Only create edge if target node exists and is different from source
              if (
                targetId &&
                graph.hasNode(targetId) &&
                sourceId !== targetId
              ) {
                if (!graph.hasEdge(sourceId, targetId)) {
                  graph.addEdge(sourceId, targetId, { type: "LINKS_TO" });
                }
              }
            }
          });
      }
    });
  }

  // Phase 4: Discover and parse JavaScript implementation files
  console.log("Processing code for graph...");
  const jsFiles = await glob(path.join(CODE_DIR, "**/*.mts"));
  console.log(`Found ${jsFiles.length} code file(s) in ${CODE_DIR}`);
  if (jsFiles.length === 0) {
    console.warn(`Warning: No code files found in ${CODE_DIR}`);
  }

  // Phase 5: Extract evaluation functions and link to spec sections
  for (const file of jsFiles) {
    const fileName = path.basename(file);
    const content = fs.readFileSync(file, "utf-8");

    // Pattern matches: export function*? Evaluate_<Name>
    // The engine262 project uses this naming convention for spec implementations
    const functionMatches = content.matchAll(
      /export function\*? (Evaluate_([a-zA-Z0-9_]+))/g,
    );
    for (const match of functionMatches) {
      const fullFuncName = match[1];
      const shortName = match[2];
      const funcNodeId = `func-${fullFuncName}`;

      // Create node for this function if not already exists
      if (!graph.hasNode(funcNodeId)) {
        graph.addNode(funcNodeId, {
          name: fullFuncName,
          type: "JSFunction",
          file: fileName,
        });
      }

      // Link function to spec section using naming convention heuristic
      // Example: Evaluate_IfStatement -> sec-if-statement
      // Converts CamelCase to kebab-case: IfStatement -> if-statement
      const specId = `sec-${shortName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
      if (graph.hasNode(specId)) {
        graph.addEdge(funcNodeId, specId, { type: "IMPLEMENTS" });
      }
    }
  }

  // Phase 6: Export the completed graph to JSON
  console.log(`Graph built with ${graph.order} nodes and ${graph.size} edges.`);
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph.export(), null, 2));
  console.log(`Graph saved to ${GRAPH_FILE}`);
}

buildGraph().catch(console.error);
