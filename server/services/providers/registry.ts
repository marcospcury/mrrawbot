import type { Provider } from "@shared/types.ts"
import { cerebrasAdapter } from "./cerebras.ts"
import { makeChatAgentRunner } from "./chatAgent.ts"
import { runClaude } from "./claude.ts"
import { runCodex } from "./codex.ts"
import { huggingfaceAdapter } from "./huggingface.ts"
import { ollamaAdapter, runOllama } from "./ollama.ts"
import { openrouterAdapter } from "./openrouter.ts"
import type { ChatProviderAdapter, ProviderRunner } from "./types.ts"

/**
 * Providers that run through the shared LangChain agent loop. Claude and Codex
 * are not here — they ship their own full agent harnesses (Claude Agent SDK /
 * Codex app-server) and only share the `ProviderRunner` contract.
 */
export const CHAT_ADAPTERS: Partial<Record<Provider, ChatProviderAdapter>> = {
  ollama: ollamaAdapter,
  openrouter: openrouterAdapter,
  huggingface: huggingfaceAdapter,
  cerebras: cerebrasAdapter,
}

/** One runner per provider — the single dispatch table for every orchestrator. */
export const RUNNERS: Record<Provider, ProviderRunner> = {
  claude: runClaude,
  codex: runCodex,
  ollama: runOllama,
  openrouter: makeChatAgentRunner(openrouterAdapter),
  huggingface: makeChatAgentRunner(huggingfaceAdapter),
  cerebras: makeChatAgentRunner(cerebrasAdapter),
}
