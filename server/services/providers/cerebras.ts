import { env } from "../../env.ts"
import { openAICompatibleAdapter } from "./openaiCompatible.ts"
import type { ChatProviderAdapter } from "./types.ts"

// Snapshot of the Cerebras Inference catalog, 2026-07-05. The live listing
// (api.cerebras.ai/v1/models, key required) replaces this whenever reachable.
const CEREBRAS_FALLBACK_MODELS = [
  "gpt-oss-120b",
  "llama-3.3-70b",
  "llama3.1-8b",
  "qwen-3-235b-a22b-instruct-2507",
  "qwen-3-coder-480b",
  "zai-glm-4.6",
]

export const cerebrasAdapter: ChatProviderAdapter = openAICompatibleAdapter({
  provider: "cerebras",
  label: "Cerebras",
  baseUrl: () => env.cerebrasBaseUrl,
  apiKey: () => env.cerebrasApiKey,
  defaultModel: () => env.cerebrasDefaultModel,
  fallbackModels: CEREBRAS_FALLBACK_MODELS,
  setupHint: "Add your Cerebras API key in Settings (get one at cloud.cerebras.ai).",
  listRequiresKey: true,
})
