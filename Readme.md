# RAG Pipeline for Language Specification Exploration

This project implements a RAG-based AI chat agent to explore the ECMAScript specification and its implementation in `engine262`.

## Prerequisites

- **Node.js**: Version 18+
- **Ollama**: Installed locally with an embedding model (e.g., `nomic-embed-text`)
- **OpenAI-compatible Endpoint**: A hosted or local LLM service

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Prepare environment**:
   ```bash
   export OPENAI_API_BASE="your_endpoint_base_url"
   export OPENAI_API_KEY="your_api_key"
   ```

3. **Clone specification**:
   (Ensure `./spec-built/multipage` contains the HTML files)

4. **Ingest data**:
   ```bash
   node ingest.mjs
   ```
   *Note: This will take significant time as it generates local embeddings via Ollama for both the spec and the implementation.*

5. **Build graph**:
   ```bash
   node build_graph.mjs
   ```

## Usage

Ask the agent questions about how code relates to the specification:

```bash
node agent.mjs "Explain how the 'if' statement works and show its implementation."
```

The agent will use tools to search the specification, explore the implementation code, and navigate the relationships between them using the graph.
