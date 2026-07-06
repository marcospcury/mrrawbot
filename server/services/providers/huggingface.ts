import { env } from "../../env.ts"
import { openAICompatibleAdapter } from "./openaiCompatible.ts"
import type { ChatProviderAdapter } from "./types.ts"

// Snapshot of tool-calling models on the Hugging Face Inference Providers
// router, 2026-07-05. The live catalog (router.huggingface.co/v1/models)
// replaces this whenever it is reachable.
const HUGGINGFACE_FALLBACK_MODELS = [
  "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "Qwen/Qwen3-Coder-480B-A35B-Instruct",
  "deepseek-ai/DeepSeek-V3.1",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
  "moonshotai/Kimi-K2-Instruct",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "zai-org/GLM-4.6",
]

export const huggingfaceAdapter: ChatProviderAdapter = openAICompatibleAdapter({
  provider: "huggingface",
  label: "Hugging Face",
  baseUrl: () => env.huggingfaceBaseUrl,
  apiKey: () => env.huggingfaceApiKey,
  defaultModel: () => env.huggingfaceDefaultModel,
  fallbackModels: HUGGINGFACE_FALLBACK_MODELS,
  setupHint: "Add your Hugging Face access token in Settings (create one at huggingface.co/settings/tokens).",
  // Public listing endpoint, but keep unconfigured providers on the curated
  // fallback list (same reasoning as OpenRouter).
  listRequiresKey: true,
})
