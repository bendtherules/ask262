import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import * as cheerio from 'cheerio';
import { 
  Document, 
  VectorStoreIndex, 
  Settings, 
  storageContextFromDefaults, 
  SentenceSplitter 
} from 'llamaindex';
import { OllamaEmbedding } from '@llamaindex/ollama';

// Configure Settings
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text-v2-moe",
});

const SPEC_DIR = './spec-built/multipage';
const CODE_DIR = './engine262/src';
import { STORAGE_DIR } from './constants.mjs';

// Initialize a SentenceSplitter with even smaller chunk size
const sentenceSplitter = new SentenceSplitter({ chunkSize: 256, chunkOverlap: 20 });

async function ingestSpec() {
  const htmlFiles = await glob(path.join(SPEC_DIR, '*.html')); 
  const documents = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const $ = cheerio.load(content);

    $('emu-clause').each((i, elem) => {
      const id = $(elem).attr('id');
      const title = $(elem).find('h1').first().text().trim();
      // Only extract immediate text to avoid excessive chunking of child sections
      const text = $(elem).clone().children('emu-clause').remove().end().text().trim();

      if (id && title && text) {
        documents.push(new Document({
          text,
          metadata: {
            source: file,
            sectionId: id,
            sectionTitle: title,
            type: 'specification'
          }
        }));
      }
    });
  }
  return documents;
}

// ingestCode function removed as requested

async function main() {
  console.log("Ingesting specification...");
  const specDocs = await ingestSpec();
  console.log(`Ingested ${specDocs.length} specification sections.`);

  console.log("Splitting documents into nodes...");
  const rawNodes = sentenceSplitter.getNodesFromDocuments(specDocs);
  console.log(`Total raw nodes generated: ${rawNodes.length}`);

  // Safety filter to ensure no node exceeds context limit
  const nodes = rawNodes.filter(node => {
    const contentLen = node.getContent().length;
    if (contentLen > 2000) {
        console.warn(`Skipping node with length ${contentLen} from ${node.metadata.source || 'unknown'}`);
        return false;
    }
    return true;
  });
  console.log(`Total valid nodes for indexing: ${nodes.length}`);

  console.log("Creating storage context...");
  const storageContext = await storageContextFromDefaults({
    persistDir: STORAGE_DIR,
  });

  console.log("Building index (this might take a while with local Ollama)...");
  
  const BATCH_SIZE = 50;
  let index;
  
  // Try to load existing index if any
  try {
    index = await VectorStoreIndex.init({
      storageContext,
    });
    console.log("Existing index found, continuing ingestion...");
  } catch (e) {
    console.log("No existing index found, starting fresh.");
  }

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${i / BATCH_SIZE + 1} / ${Math.ceil(nodes.length / BATCH_SIZE)}...`);
    
    if (!index) {
        index = await VectorStoreIndex.init({
            storageContext,
            nodes: batch
        });
    } else {
        // Here we'd ideally skip nodes already in the index,
        // but for simplicity we'll just continue or assume 
        // we're starting fresh for this run if index was null.
        // To truly resume, we need more logic.
        await index.insertNodes(batch);
    }
  }

  console.log(`Index built and persisted to ${STORAGE_DIR}`);
}

main().catch(console.error);
