# Ask262

MCP server for exploring the ECMAScript specification and its implementation in [engine262](https://github.com/bendtherules/engine262).

## Features

- **Vector search** ECMAScript specification sections using semantic queries
- **Execute JavaScript** in engine262 and capture which spec sections are hit
- **Knowledge graph** mapping spec sections to implementation functions
- **1-second timeout** on code execution for safety

## Prerequisites

- **Bun**: Version 1.0.0 or higher ([install](https://bun.sh/docs/installation))
- **Ollama**: Installed locally with `qwen3-embedding:0.6b` model pulled (`ollama pull qwen3-embedding:0.6b`)

### Environment Variables

- `OLLAMA_HOST` (optional): Ollama server URL. Defaults to `http://localhost:11434`

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

## MCP Configuration

Add to your MCP client configuration using `bunx` (no installation required):

**Claude Desktop** (`claude_desktop_config.json`):
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

**OpenCode** (global config `~/.config/opencode/opencode.json` or project config `opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ask262": {
      "type": "local",
      "command": ["bunx", "ask262"],
      "enabled": true
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

## Development

For development or using a custom ECMAScript specification:

1. **Clone and setup**:
   ```bash
   git clone https://github.com/bendtherules/ask262
   cd ask262
   bun install
   ```

2. **Ensure spec is present**:
   - `./spec-built/multipage/` - ECMAScript spec HTML files

3. **Build knowledge graph** (if using custom spec):
   ```bash
   bun run build
   ```

4. **Release to npm** (maintainers only):
   ```bash
   bun run release
   ```
   This will:
   - Check for uncommitted git changes
   - Bump patch version (e.g., 0.0.1 → 0.0.2)
   - Fix any hard links in `storage/`
   - Run checks and release

   Other options: `bun run release -- --minor`, `bun run release -- --major`, or `bun run release -- --no-bump`

## License

ISC
