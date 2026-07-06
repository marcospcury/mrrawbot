import {
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import type { StructuredToolInterface } from "@langchain/core/tools"
import type { StepUsage } from "@shared/types.ts"
import { makeRepoTools } from "./repoTools.ts"
import { makeSkillTools } from "./skillTools.ts"
import type { ChatProviderAdapter, ProviderRunInput, ProviderRunOutput, ProviderRunner } from "./types.ts"

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

function normalizeUsage(message: AIMessageChunk): StepUsage | null {
  const usage = (message as { usage_metadata?: Record<string, unknown> }).usage_metadata
  if (usage) {
    const inputDetails = usage.input_token_details as Record<string, unknown> | undefined
    const outputDetails = usage.output_token_details as Record<string, unknown> | undefined
    return compactUsage({
      inputTokens: asNumber(usage.input_tokens),
      cachedInputTokens: asNumber(inputDetails?.cache_read),
      outputTokens: asNumber(usage.output_tokens),
      reasoningOutputTokens: asNumber(outputDetails?.reasoning),
      totalTokens: asNumber(usage.total_tokens),
    })
  }

  // ChatOllama fallback: some responses only carry native eval counts.
  const metadata = (message as { response_metadata?: Record<string, unknown> }).response_metadata
  const inputTokens = asNumber(metadata?.prompt_eval_count)
  const outputTokens = asNumber(metadata?.eval_count)
  return compactUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined,
  })
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

/** Wrap an adapter into the `ProviderRunner` shape the orchestrator dispatches on. */
export function makeChatAgentRunner(adapter: ChatProviderAdapter): ProviderRunner {
  return (input) => runChatAgent(adapter, input)
}

/**
 * Shared agent harness for API-based providers: a ReAct tool-calling loop
 * (LangChain) that streams tokens to the UI and gives the model repo file
 * tools scoped to the project. The adapter supplies the chat model; everything
 * else — tools, loop, streaming, usage accounting — is provider-independent.
 */
export async function runChatAgent(adapter: ChatProviderAdapter, input: ProviderRunInput): Promise<ProviderRunOutput> {
  if (!adapter.isConfigured()) {
    const hint = adapter.configHint()
    throw new Error(`${adapter.label} is not configured.${hint ? ` ${hint}` : " Add its credentials in Settings → Providers."}`)
  }

  const tools = [
    ...makeRepoTools(input.cwd, input.signal, input.workspaceDir, input.uploadsDir),
    ...makeSkillTools(input.cwd, input.skillDirs ?? []),
  ]
  const toolMap = new Map<string, StructuredToolInterface>(tools.map((t) => [t.name, t]))
  const model = input.model || adapter.defaultModel()
  const makeLlm = (effort: typeof input.effort) =>
    adapter.makeChatModel({ model, temperature: input.temperature, effort }).bindTools(tools)
  let llm = makeLlm(input.effort)
  // Not every model on an OpenAI-compatible provider accepts a reasoning-effort
  // parameter; when one rejects it, drop the setting and keep going instead of
  // failing the whole run.
  let effortActive = input.effort !== null

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
    const streamOnce = async () => {
      let out: AIMessageChunk | undefined
      const stream = await llm.stream(messages, { signal: input.signal })
      for await (const chunk of stream) {
        out = out ? out.concat(chunk) : chunk
        const text = extractText(chunk.content)
        if (text) input.onToken?.(text)
      }
      return out
    }
    try {
      agg = await streamOnce()
    } catch (e) {
      const message = (e as Error).message ?? String(e)
      if (!effortActive || !/reasoning[_\s-]?effort/i.test(message)) throw e
      effortActive = false
      llm = makeLlm(null)
      input.onLog?.(`⚠ ${model} rejected the reasoning effort setting; continuing without it.`)
      agg = await streamOnce()
    }
    if (!agg) break

    usage = addUsage(usage, normalizeUsage(agg))
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

  const compacted = compactUsage(usage)
  const withCost =
    compacted && adapter.estimateCostUsd
      ? { ...compacted, costUsd: compacted.costUsd ?? (await adapter.estimateCostUsd(model, compacted)) }
      : compacted
  return { text: finalText, usage: withCost }
}
