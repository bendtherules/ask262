# AGENTS.md - Ask262 Project Guide

## Project Overview

**Ask262** is a RAG-based MCP server for exploring the ECMAScript specification via [engine262](https://github.com/bendtherules/engine262). Users ask questions like *"How does array.map work?"* and get answers grounded in the actual spec and implementation.

**Stack:** Vector search (LanceDB + Ollama/Fireworks embeddings) → Knowledge graph → LLM reasoning. Runs as MCP server (stdio or HTTP) for Claude Desktop, OpenCode, etc.

## Commands

```bash
bun run ingest          # Ingest spec HTML into vector DB
bun run build           # Build knowledge graph
bun run lint            # Biome check
bun run type-check      # TypeScript strict check
bun test                # Run all Bun tests
bun run ask262-stdio    # Stdio transport
bun run ask262-http     # HTTP transport (port 8081)
```

## Project Structure

**Core:**
`src/agent-tools/` - MCP tool implementations
`src/mcp-server-stdio.ts` - Stdio server entry
`src/mcp-server-http.ts` - HTTP server entry

**Data:**
`storage/` - LanceDB vector index
`spec-built/multipage/` - ECMAScript spec HTML
`engine262/` - JS engine implementation (git submodule, ignored)
`graphology/` - Knowledge graph JSON

**Setup:**
`src/setup/ingest.ts` - Creates vector DB from spec
`src/setup/buildGraph.ts` - Maps spec sections to code

## Code Style

**Imports:** ES modules only. Node built-ins use `node:` prefix. Never CommonJS.

**Formatting (Biome):** 2 spaces, 80 char width, LF endings. Excludes: `spec-built/`, `engine262/`, `graphology/`.

**TypeScript:** Strict mode enabled. Explicit return types. Avoid `any`. Target: ES2022.

**Naming:** Folders kebab-case (`agent-tools`). Files camelCase (`buildGraph.ts`). Functions camelCase (`createTool`). Constants UPPER_SNAKE_CASE. Types PascalCase.

**Error Handling:** Try/catch with meaningful messages. Validate env vars. Log warnings for missing config.

**Comments & Documentation:**
- JSDoc for public functions: purpose, params, return values, examples
- Use `/** */` for documentation blocks
- Use `//` for inline implementation notes
- Document complex logic or non-obvious decisions

## Environment

Copy `.env.example` to `.env`:
- `ASK262_EMBEDDING_PROVIDER` - `ollama` or `fireworks`
- `FIREWORKS_API_KEY` - Required for Fireworks
- `OLLAMA_HOST` - Ollama URL (default: http://localhost:11434)
- `ASK262_PORT` - HTTP server port (default: 8081)
- `MCP_PUBLIC_URL` - Public URL for inspector

## Key Dependencies

- **LanceDB** - Vector storage
- **Ollama** / **Fireworks** - Embeddings
- **LangChain** - LLM framework
- **Hono** - HTTP server
- **Biome** - Lint/format

## Important Notes

- TypeScript only - no plain JS
- Run `bun run type-check` before committing
- Ingest/build are slow (local embedding generation)
- Don't lint/format external dirs (`engine262/`, `spec-built/`, `graphology/`)
