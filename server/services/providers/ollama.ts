import { ChatOllama } from "@langchain/ollama"
import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { Effort, StepUsage } from "@shared/types.ts"
import { env } from "../../env.ts"
import { estimateOllamaCostUsd } from "./pricing.ts"
import { makeRepoTools } from "./repoTools.ts"
import { makeSkillTools } from "./skillTools.ts"
import type { ProviderRunInput, ProviderRunOutput } from "./types.ts"

// Ollama "think": off for low effort, on for anything higher.
function ollamaThink(effort: Effort | null): boolean | undefined {
  if (!effort) return undefined
  return effort !== "low"
}

// Hard safety ceiling on the agent loop. A real harness runs the model until it
// stops calling tools — it does NOT cap "turns" at some small number. This bound
// only exists to prevent a pathological infinite tool-calling loop from running
// forever; in practice the model returns a tool-free message long before this.
const MAX_AGENT_STEPS = 250

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function compactUsage(usage: StepUsage): StepUsage | null {
  return Object.values(usage).some((v) => typeof v === "number" && Number.isFinite(v)) ? usage : null
}

function addUsage(total: StepUsage, next: StepUsage | null): StepUsage {
  if (!next) return total
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    reasoningOutputTokens: (total.reasoningOutputTokens ?? 0) + (next.reasoningOutputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (next.totalTokens ?? 0),
  }
}

function normalizeOllamaUsage(message: AIMessageChunk): StepUsage | null {
  const usage = (message as { usage_metadata?: Record<string, unknown> }).usage_metadata
  if (usage) {
    return compactUsage({
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      totalTokens: asNumber(usage.total_tokens),
    })
  }

  const metadata = (message as { response_metadata?: Record<string, unknown> }).response_metadata
  const inputTokens = asNumber(metadata?.prompt_eval_count)
  const outputTokens = asNumber(metadata?.eval_count)
  return compactUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined,
  })
}

function withOllamaCost(model: string, usage: StepUsage | null): StepUsage | null {
  if (!usage) return null
  return { ...usage, costUsd: usage.costUsd ?? estimateOllamaCostUsd(model, usage) }
}

function extractText(content: MessageContent): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c?.type === "text" ? (c as { text?: string }).text ?? "" : ""))
      .join("")
  }
  return ""
}

export function makeOllama(model: string, temperature: number | null, think?: boolean) {
  const headers: Record<string, string> = {}
  if (env.ollamaApiKey) headers.Authorization = `Bearer ${env.ollamaApiKey}`
  return new ChatOllama({
    model: model || env.ollamaDefaultModel,
    baseUrl: env.ollamaBaseUrl,
    headers,
    temperature: temperature ?? undefined,
    ...(think !== undefined ? { think } : {}),
  })
}

/**
 * Ollama Cloud agent with its own ReAct tool-calling loop (LangChain), streaming
 * tokens to the UI and giving the model repo file tools scoped to the project.
 */
export async function runOllama(input: ProviderRunInput): Promise<ProviderRunOutput> {
  if (!env.ollamaApiKey) {
    throw new Error("Ollama Cloud API key is not configured. Add it in Settings → Providers.")
  }

  const tools = [
    ...makeRepoTools(input.cwd, input.signal, input.workspaceDir),
    ...makeSkillTools(input.cwd, input.skillDirs ?? []),
  ]
  const toolMap = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]))
  const model = input.model || env.ollamaDefaultModel
  const llm = makeOllama(model, input.temperature, ollamaThink(input.effort)).bindTools(tools)

  const messages: BaseMessage[] = []
  if (input.system) messages.push(new SystemMessage(input.system))
  messages.push(new HumanMessage(input.prompt))

  let finalText = ""
  let usage: StepUsage = {}

  // ReAct loop: keep going until the model answers without requesting a tool.
  // The loop is NOT bounded by a turn budget — it ends when the agent is done.
  let step = 0
  for (; step < MAX_AGENT_STEPS; step++) {
    if (input.signal.aborted) break

    let agg: AIMessageChunk | undefined
    const stream = await llm.stream(messages, { signal: input.signal })
    for await (const chunk of stream) {
      agg = agg ? agg.concat(chunk) : chunk
      const text = extractText(chunk.content)
      if (text) input.onToken?.(text)
    }
    if (!agg) break

    usage = addUsage(usage, normalizeOllamaUsage(agg))
    messages.push(agg)
    const toolCalls = agg.tool_calls ?? []
    const text = extractText(agg.content)
    if (text && toolCalls.length === 0) finalText = text

    if (toolCalls.length === 0) break

    for (const tc of toolCalls) {
      const t = toolMap.get(tc.name)
      const callId = tc.id ?? `${tc.name}-${step}`
      input.onTool?.({ id: callId, name: tc.name, args: tc.args })
      let result: string
      try {
        result = t ? String(await t.invoke(tc.args)) : `Error: unknown tool "${tc.name}"`
      } catch (e) {
        result = `Error: ${(e as Error).message}`
      }
      input.onTool?.({ id: callId, name: tc.name, result })
      messages.push(new ToolMessage({ content: result, tool_call_id: callId }))
    }
  }

  if (step >= MAX_AGENT_STEPS) {
    input.onLog?.(`⚠ reached the ${MAX_AGENT_STEPS}-step safety limit; stopping the agent loop.`)
  }

  if (!finalText) {
    // Last resort: surface whatever the final assistant message contained.
    const lastAi = [...messages].reverse().find((m) => m instanceof AIMessageChunk) as AIMessageChunk | undefined
    finalText = lastAi ? extractText(lastAi.content) : ""
  }

  return { text: finalText, usage: withOllamaCost(model, compactUsage(usage)) }
}
