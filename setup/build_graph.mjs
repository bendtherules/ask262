import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import * as cheerio from 'cheerio';
import { Graph } from 'graphology';

const SPEC_DIR = './spec-built/multipage';
const CODE_DIR = './engine262/src';
import { GRAPH_FILE } from '../constants.mjs';

async function buildGraph() {
  const graph = new Graph({ multi: true });
  const htmlFiles = await glob(path.join(SPEC_DIR, '*.html'));

  console.log("Processing specification for graph...");
  for (const file of htmlFiles) {
    const fileName = path.basename(file);
    const content = fs.readFileSync(file, 'utf-8');
    const $ = cheerio.load(content);

    $('emu-clause').each((i, elem) => {
      const id = $(elem).attr('id');
      const title = $(elem).find('h1').first().text().trim();
      
      if (id) {
        if (!graph.hasNode(id)) {
          graph.addNode(id, { title, type: 'SpecSection', file: fileName });
        }

        // Extract internal links
        $(elem).find('a[href]').each((j, link) => {
          const href = $(link).attr('href');
          if (href && href.includes('#')) {
            const [targetFile, targetId] = href.split('#');
            // We only care about links to other sections for now
            if (targetId && targetId.startsWith('sec-')) {
              // Add relationship later if nodes exist
            }
          }
        });
      }
    });
  }

  // Add edges for internal links
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const $ = cheerio.load(content);
    $('emu-clause').each((i, elem) => {
      const sourceId = $(elem).attr('id');
      if (sourceId && graph.hasNode(sourceId)) {
        $(elem).find('a[href]').each((j, link) => {
          const href = $(link).attr('href');
          if (href && href.includes('#')) {
            const [, targetId] = href.split('#');
            if (targetId && graph.hasNode(targetId) && sourceId !== targetId) {
               if (!graph.hasEdge(sourceId, targetId)) {
                  graph.addEdge(sourceId, targetId, { type: 'LINKS_TO' });
               }
            }
          }
        });
      }
    });
  }

  console.log("Processing code for graph...");
  const jsFiles = await glob(path.join(CODE_DIR, '**/*.mts'));

  for (const file of jsFiles) {
    const fileName = path.basename(file);
    const content = fs.readFileSync(file, 'utf-8');
    
    // Simple heuristic: look for function names starting with Evaluate_
    const functionMatches = content.matchAll(/export function\*? (Evaluate_([a-zA-Z0-9_]+))/g);
    for (const match of functionMatches) {
      const fullFuncName = match[1];
      const shortName = match[2];
      const funcNodeId = `func-${fullFuncName}`;

      if (!graph.hasNode(funcNodeId)) {
        graph.addNode(funcNodeId, { name: fullFuncName, type: 'JSFunction', file: fileName });
      }

      // Try to link to a spec section
      // Heuristic: Evaluate_IfStatement -> sec-if-statement
      const specId = `sec-${shortName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
      if (graph.hasNode(specId)) {
        graph.addEdge(funcNodeId, specId, { type: 'IMPLEMENTS' });
      }
    }
  }

  console.log(`Graph built with ${graph.order} nodes and ${graph.size} edges.`);
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph.export(), null, 2));
  console.log(`Graph saved to ${GRAPH_FILE}`);
}

buildGraph().catch(console.error);
