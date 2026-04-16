export const STORAGE_DIR = "./storage";
export const SPEC_DIR = "./spec-built/multipage";
export const CODE_DIR = "./engine262/src";
export const GRAPH_FILE = "./graphology/graph.json";

// Model configurations
export const OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
export const RERANKER_MODEL = "dengcao/Qwen3-Reranker-0.6B:Q8_0";

// Embedding provider configuration
export const EMBEDDING_PROVIDER =
  process.env.ASK262_EMBEDDING_PROVIDER ?? "ollama";
export const FIREWORKS_EMBEDDING_MODEL = "fireworks/qwen3-embedding-8b";
export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
