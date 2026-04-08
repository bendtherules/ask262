# AGENTS.md - Ask262 Project Guide

## Project Overview

**Ask262** is a RAG-based AI chat agent for exploring the ECMAScript specification and its implementation in [engine262](https://github.com/bendtherules/engine262) (a JavaScript engine written in JavaScript).

The agent combines:
- **Vector search** (via LlamaIndex + Ollama embeddings) to find relevant spec sections
- **Knowledge graph** (via Graphology) mapping spec sections to implementation functions
- **LLM reasoning** (via OpenAI-compatible API) to answer questions about JavaScript internals

Users ask questions like: *"How does the if statement work?"* or *"Which function implements sec-if-statement?"*

## Prerequisites

- **Node.js** 18+ with Bun runtime
- **Ollama** installed locally with `nomic-embed-text` model
- **NVIDIA API key** (or other OpenAI-compatible endpoint) in `config.json`

## Project Structure

```
ask262/
├── agent.ts              # Main ReAct agent - answers user queries
├── agent-tools/          # Agent tool implementations
├── constants.ts          # Directory paths and file locations
├── config.json           # API keys and endpoints (user-created)
├── setup/
│   ├── ingest.ts         # Ingests spec HTML into vector index
│   ├── buildGraph.ts     # Builds knowledge graph (spec → code mappings)
│   └── stripSpecContainer.ts   # Cleans spec HTML files
├── spec-built/multipage/ # ECMAScript spec HTML files (ecmarkup output)
├── engine262/src/        # JavaScript engine implementation code
├── storage/              # Vector index persistence (LlamaIndex)
└── graphology/           # Knowledge graph JSON file
```

**Key Files:**
- `agent.ts`: ReAct agent with two tools - `spec_retriever` (vector search) and `graph_explorer` (graph navigation)
- `setup/ingest.ts`: Parses HTML files, extracts `emu-clause` sections, chunks them, creates embeddings
- `setup/buildGraph.ts`: Parses spec sections and code functions, creates nodes/edges showing which functions implement which spec sections
- `constants.ts`: Defines `STORAGE_DIR`, `SPEC_DIR`, `CODE_DIR`, `GRAPH_FILE`

## Commands

**Manual:**
```bash
bun run setup/ingest.ts     # Direct ingest execution
bun run setup/buildGraph.ts  # Direct graph build
bun run agent.ts "Your question here"  # Direct agent execution
```

## File / Folder Naming
Name all folders in kebab-case. Ex - hello-world
Name all files in camelcase. Ex - helloWorld

## Code Style Guidelines

### Imports & Modules
- Use ES modules (`import/export`), never CommonJS
- Node.js built-ins: `import fs from "node:fs"` (with `node:` prefix)
- Third-party: `import * as cheerio from "cheerio"`
- Type: `"type": "module"` in package.json

### Formatting (Biome)
- **Indent**: 2 spaces (not tabs)
- Excluded: `spec-built/`, `engine262/`, `graphology/` (external/vendor)

### TypeScript
- **Target**: ES2022
- **Strict mode**: Enabled
- **Module resolution**: Node
- Explicit types for function parameters and return values
- Use `as const` for literal arrays
- Avoid `any` - use proper types or `unknown`

### Comments & Documentation
- JSDoc for public functions explaining purpose, params, return values
- Inline comments for complex logic or non-obvious decisions
- Use `//` for implementation notes, `/** */` for documentation

## Important notes

1. Always use Typescript for implementation. Don't use plain javascript.
<!-- 2. Documentation for llamaIndex is  -->