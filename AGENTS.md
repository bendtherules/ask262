# AGENTS.md - Ask262 Project Guide

## Project Overview

**Ask262** is a RAG-based AI chat agent for exploring the ECMAScript specification and its implementation in [engine262](https://github.com/bendtherules/engine262) (a JavaScript engine written in JavaScript).

The agent combines:
- **Vector search** (via LanceDB + Ollama embeddings) to find relevant spec sections
- **Knowledge graph** (via Graphology) mapping spec sections to implementation functions
- **LLM reasoning** (via OpenAI-compatible API) to answer questions about JavaScript internals

Users ask questions like: *"How does the if statement work?"* or *"Which function implements sec-if-statement?"*

## Prerequisites

- **Node.js** 18+ with Bun runtime (packageManager: bun@1.2.8)
- **Ollama** installed locally with embedding model (e.g., `qwen3-embedding:0.6b`)

## Project Structure

```
ask262/
├── src/
│   ├── agent.ts              # Main ReAct agent - answers user queries
│   ├── constants.ts          # Directory paths and model configs
│   ├── agent-tools/          # Tool implementations (spec retriever, graph explorer)
│   │   ├── index.ts          # Tool exports
│   │   ├── searchSpecSections.ts   # Vector search tool
│   │   ├── getSectionContent.ts    # Section chunk retrieval tool
│   │   ├── graphExplorer.ts  # Knowledge graph navigation tool
│   │   ├── evaluateInEngine262.ts  # Execute JS and capture spec marks
│   │   └── reranker.ts       # Document reranking utility
│   └── setup/                # Data ingestion and graph building
│       ├── ingest.ts         # Ingests spec HTML into vector index
│       ├── buildGraph.ts     # Builds knowledge graph
│       ├── stripSpecContainer.ts # Cleans spec HTML files
│       ├── htmlAddInternalMethodLink.ts  # Adds internal method links
│       ├── text-splitters/   # Text chunking utilities
│       └── utils/            # Formatting utilities
│   ├── mcp-server.ts         # MCP server for external tool integration
│   └── test/                 # Manual verification tests
│       └── manual/
│           ├── verify-db.ts              # Verify database contents
│           ├── test-search-spec-sections.ts    # Test vector search tool
│           └── test-evaluate-in-engine262.ts  # Test evaluate tool
├── spec-built/multipage/     # ECMAScript spec HTML files
├── engine262/src/            # JavaScript engine implementation
├── storage/                  # Vector index persistence (LanceDB)
├── graphology/               # Knowledge graph JSON file
├── biome.json                # Biome formatter config
├── tsconfig.json             # TypeScript strict config
└── package.json              # Bun-based dependencies
```

## Commands

```bash
bun run ingest          # Ingest spec HTML into vector index
bun run build           # Build knowledge graph (spec → code mappings)
bun run lint            # Check code with Biome
bun run lint:fix        # Fix auto-fixable issues
bun run format:fix      # Format code with Biome
bun run type-check      # TypeScript check (no emit)
bun test                # Run all tests
bun run test-evaluate   # Test evaluate in engine262 tool
bun run test-search-spec-sections "query"  # Test vector search tool with query
bun run agent "Query"   # Run agent with question
bun run mcp-server      # Start MCP server (stdio transport)
bun run test-mcp-server # Test MCP server with all tools
```

## MCP Server

Ask262 can run as an MCP (Model Context Protocol) server, making its tools available to any MCP-compatible client (Claude Desktop, OpenCode, etc.).

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `ask262_search_spec_sections` | Vector search ECMAScript spec for relevant sections |
| `ask262_get_section_content` | Retrieve full content from a spec section |
| `ask262_evaluate_in_engine262` | Execute JS in engine262 and capture spec sections |

### Configuration

Add to your MCP client configuration:

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "ask262": {
      "command": "bun",
      "args": ["run", "/path/to/ask262/src/mcp-server.ts"],
      "cwd": "/path/to/ask262"
    }
  }
}
```

**OpenCode (`.opencode/mcp.json` or `~/.config/opencode/opencode.json`):**

*stdio (local process):*
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ask262": {
      "type": "local",
      "command": ["bun", "run", "src/mcp-server.ts"],
      "enabled": true,
      "environment": {
        "OLLAMA_HOST": "http://localhost:11434"
      }
    }
  }
}
```

*http (stateless JSON server):*
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ask262": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "enabled": true
    }
  }
}
```

Start the HTTP server first:
```bash
bun run mcp-http        # Development
ask262-http             # After npm install -g
```

### Testing

Test the MCP server before configuring your client:

```bash
# Run automated tests for all MCP tools
bun run test-mcp-server
```

This tests:
- Tool listing
- Vector search (`ask262_search_spec_sections`)
- Section content retrieval (`ask262_get_section_content`)
- Code evaluation with console capture (`ask262_evaluate_in_engine262`)

### Prerequisites

Before running the MCP server:
1. Ensure `storage/` directory exists with ingested spec vectors (`bun run ingest`)
2. Ensure Ollama is running with `qwen3-embedding:0.6b` model

## Code Style Guidelines

### Imports & Modules
- Use ES modules (`import/export`), never CommonJS
- Node.js built-ins: `import fs from "node:fs"` (with `node:` prefix)
- Third-party: `import * as cheerio from "cheerio"`
- Package type: `"type": "module"` in package.json

### Formatting (Biome)
- **Indent**: 2 spaces (not tabs)
- **Line width**: 80 characters
- **Line ending**: LF
- **Excluded directories**: `spec-built/`, `engine262/`, `graphology/` (external/vendor)

### TypeScript
- **Target**: ES2022
- **Strict mode**: Enabled with `strict: true`
- **Module resolution**: Node
- Explicit types for function parameters and return values
- Use `as const` for literal arrays
- Avoid `any` - use proper types or `unknown`
- JSON imports: `resolveJsonModule: true`

### Naming Conventions
- **Folders**: kebab-case (e.g., `agent-tools`, `text-splitters`)
- **Files**: camelCase (e.g., `buildGraph.ts`, `specRetriever.ts`)
- **Functions**: camelCase (e.g., `createGraphExplorerTool`)
- **Constants**: UPPER_SNAKE_CASE or camelCase for exported constants
- **Types/Interfaces**: PascalCase with descriptive names

### Comments & Documentation
- JSDoc for public functions explaining purpose, params, return values
- Use `/** */` for documentation blocks
- Use `//` for inline implementation notes
- Document complex logic or non-obvious decisions

### Error Handling
- Use `try/catch` for async operations with meaningful error messages
- Validate environment variables
- Check file existence before reading
- Log warnings for missing configuration rather than failing silently

## Key Dependencies

- **LangChain**: Agent framework and LLM integration (`langchain`, `@langchain/*`)
- **LanceDB**: Vector storage for embeddings (`@lancedb/lancedb`)
- **Ollama**: Local embeddings (`@langchain/ollama`)
- **Graphology**: Knowledge graph library (`graphology`)
- **Cheerio**: HTML parsing (`cheerio`)
- **Biome**: Linting and formatting (`@biomejs/biome`)

## Important Notes

1. Always use TypeScript for implementation - no plain JavaScript
2. Run type-check before committing: `bun run type-check`
3. Ingest and build commands can take significant time due to local embedding generation
4. External directories (`spec-built/`, `engine262/`, `graphology/`) should not be modified by linting/formatting
