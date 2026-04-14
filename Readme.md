# Ask262

MCP server for exploring the ECMAScript specification and its implementation in [engine262](https://github.com/bendtherules/engine262).

## Features

- **Vector search** ECMAScript specification sections using semantic queries
- **Execute JavaScript** in engine262 and capture which spec sections are hit
- **Knowledge graph** mapping spec sections to implementation functions
- **1-second timeout** on code execution for safety

## Prerequisites

- **Bun**: Version 1.0.0 or higher ([install](https://bun.sh/docs/installation))
- **Ollama**: Installed locally with an embedding model (e.g., `qwen3-embedding:0.6b`)

## Installation

```bash
# Install globally with bun
bun install -g ask262

# Or run directly without installing
bunx ask262

# Or clone and install
git clone https://github.com/bendtherules/ask262
cd ask262
bun install
```

## Setup

1. **Ensure spec is present** (only external requirement):
   - `./spec-built/multipage/` - ECMAScript spec HTML files
   
   *Note: `storage/` (pre-built vectors), `engine262/lib/`, and `graphology/` are included in the package.*

2. **Build knowledge graph** (first time only, if using custom spec):
   ```bash
   bun run build
   ```

## MCP Configuration

Add to your MCP client configuration:

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ask262": {
      "command": "bun",
      "args": ["run", "/path/to/ask262/src/mcp-server.ts"]
    }
  }
}
```

**OpenCode** (`.opencode/mcp.json`):
```json
{
  "servers": {
    "ask262": {
      "command": "bun",
      "args": ["run", "src/mcp-server.ts"]
    }
  }
}
```

**Via global install** (after `bun install -g ask262`):
```json
{
  "mcpServers": {
    "ask262": {
      "command": "ask262"
    }
  }
}
```

**Via bunx** (no installation required):
```json
{
  "mcpServers": {
    "ask262": {
      "command": "bunx",
      "args": ["ask262"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `ask262_search_spec_sections` | Vector search ECMAScript spec for relevant sections |
| `ask262_get_section_content` | Retrieve full content from a spec section |
| `ask262_evaluate_in_engine262` | Execute JS in engine262 and capture spec section marks |

## Testing

```bash
# Run MCP server tests
bun run test-mcp-server

# Test evaluate tool with timeout
bun run test-evaluate-timeout

# Test search functionality
bun run test-search-spec-sections
```

## License

ISC
