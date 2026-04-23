# Ask262

MCP server for exploring the ECMAScript specification and its implementation in [engine262](https://github.com/bendtherules/engine262).

## 🎮 Try it now

The fastest way to tinker with JavaScript internals:

- **[Ask262 Chat](http://chat.ask262.bendtherules.in/)** — Ask questions in natural language (register new account)
- **[MCP Inspector](https://ask262.bendtherules.in/)** — Direct access to all mcp tools, no signup needed

## Features

- **Vector search** ECMAScript specification sections using semantic queries
- **Execute JavaScript** in engine262 and capture spec sections, with `ask262Debug.startImportant()` to mark the key parts of your code
- **Knowledge graph** mapping spec sections to implementation functions
- **1-second timeout** on code execution for safety

## Available Tools

| Tool | Description |
|------|-------------|
| `ask262_search_spec_sections` | Vector search ECMAScript spec for relevant sections |
| `ask262_get_section_content` | Retrieve full content from a spec section |
| `ask262_evaluate_in_engine262` | Execute JS and capture spec sections, with "important" marking to focus on relevant parts |

## Quick Start (Hosted Instance)

Use the hosted MCP server without any local setup:

### Preferred Method: `npx add-mcp`

Install ask262 MCP server to your client with one command:

```bash
npx add-mcp "https://ask262.bendtherules.in/mcp"
```

### Manual Configuration

If you prefer to configure manually:

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "ask262": {
      "url": "https://ask262.bendtherules.in/mcp"
    }
  }
}
```

**OpenCode** (`~/.config/opencode/opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ask262": {
      "type": "remote",
      "url": "https://ask262.bendtherules.in/mcp",
      "enabled": true
    }
  }
}
```

## Local Installation

### Prerequisites

- **Bun**: Version 1.0.0 or higher ([install](https://bun.sh/docs/installation))
- **Ollama**: Installed with `qwen3-embedding:8b` \
(`ollama pull qwen3-embedding:8b`)

### Setup

```bash
# Clone and install
git clone https://github.com/bendtherules/ask262
cd ask262
bun install

# Or install globally
bun install -g ask262
```

### Environment Configuration

Copy `.env.example` and configure:

```bash
cp .env.example .env
```

**Key variables:**
- `ASK262_EMBEDDING_PROVIDER`: Choose `ollama` (local) or `fireworks` (cloud). Default: `ollama`
- `OLLAMA_HOST`: Ollama server URL. Default: `http://localhost:11434`
- `FIREWORKS_API_KEY`: Required if using Fireworks. Get from https://app.fireworks.ai
- `ASK262_PORT`: HTTP server port. Default: `8081`

**Example `.env`:**
```bash
# Use Fireworks for embeddings (faster, cloud-based)
ASK262_EMBEDDING_PROVIDER=fireworks
FIREWORKS_API_KEY=fw_your_key_here

# Or use local Ollama (default)
# ASK262_EMBEDDING_PROVIDER=ollama
# OLLAMA_HOST=http://localhost:11434
```

### Local MCP Configuration

**Claude Desktop** (`claude_desktop_config.json`):

#### stdio (no server needed)
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

#### http (requires server)
```json
{
  "mcpServers": {
    "ask262": {
      "url": "http://localhost:8081/mcp"
    }
  }
}
```

⬇️ **Required for HTTP config above:** 
```bash
bun run ask262-http # start HTTP server
```

**OpenCode** (`~/.config/opencode/opencode.json`):

#### stdio (no server needed)
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

#### http (requires server)
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ask262": {
      "type": "remote",
      "url": "http://localhost:8081/mcp",
      "enabled": true
    }
  }
}
```

⬇️ **Required for HTTP config above:** 
```bash
bun run ask262-http # start HTTP server
```

**HTTP Server Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET/POST /mcp` | MCP protocol endpoint |
| `GET /` | MCP Inspector UI (auto-connects to /mcp) |

*Note: `/mcp` is defined before the inspector's catch-all `/` route to ensure proper request handling.*

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
   - `./spec-built/multipage/` - Built ECMAScript spec HTML files

   Steps -
   1. `git clone https://github.com/tc39/ecma262`
   2. `npm i && npm run build`
   3. copy `out/` from ecma262 to `spec-built/` in this repo

3. **Build vectors (lancedb)**
   ```bash
   bun run ingest
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
