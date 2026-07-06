import { env } from "../../env.ts"
import { openAICompatibleAdapter } from "./openaiCompatible.ts"
import type { ChatProviderAdapter } from "./types.ts"

// Snapshot of popular tool-calling models on OpenRouter, 2026-07-05. The live
// catalog (openrouter.ai/api/v1/models, filtered to tool support) replaces this
// whenever it is reachable.
const OPENROUTER_FALLBACK_MODELS = [
  "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4.5",
  "deepseek/deepseek-chat-v3.1",
  "google/gemini-2.5-pro",
  "meta-llama/llama-4-maverick",
  "mistralai/mistral-large-2411",
  "moonshotai/kimi-k2",
  "openai/gpt-5.1",
  "openai/gpt-oss-120b",
  "qwen/qwen3-coder",
  "x-ai/grok-code-fast-1",
  "z-ai/glm-4.6",
]

export const openrouterAdapter: ChatProviderAdapter = openAICompatibleAdapter({
  provider: "openrouter",
  label: "OpenRouter",
  baseUrl: () => env.openrouterBaseUrl,
  apiKey: () => env.openrouterApiKey,
  defaultModel: () => env.openrouterDefaultModel,
  fallbackModels: OPENROUTER_FALLBACK_MODELS,
  setupHint: "Add your OpenRouter API key in Settings (get one at openrouter.ai/keys).",
  // Attribution headers OpenRouter asks apps to send.
  defaultHeaders: { "X-Title": "Mr Rawbot" },
  // The agent loop needs tool calling; OpenRouter lists hundreds of models,
  // many of which can't drive tools at all.
  modelFilter: (m) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
  // The listing endpoint is public, but only pull the full live catalog once
  // the provider is actually usable — unconfigured providers show the curated
  // fallback list instead of hundreds of unusable entries.
  listRequiresKey: true,
})
