import { query } from "@anthropic-ai/claude-agent-sdk"
import type { Effort } from "@shared/types.ts"
import { env } from "../../env.ts"
import type { ProviderRunInput, ProviderRunOutput } from "./types.ts"

// Claude Agent SDK effort matches our levels exactly: low | medium | high | xhigh | max.
function claudeEffort(effort: Effort | null): Effort | undefined {
  return effort ?? undefined
}

/**
 * Run Claude Code as a one-shot agent via the local CLI (subscription auth).
 * Captures the final result text + token/cost usage.
 */
export async function runClaude(input: ProviderRunInput): Promise<ProviderRunOutput> {
  // Strip ANTHROPIC_API_KEY so the spawned CLI uses the user's subscription login
  // rather than pay-per-token API billing.
  const { ANTHROPIC_API_KEY: _drop, ...childEnv } = process.env

  const options = {
    cwd: input.cwd,
    model: input.model || env.claudeDefaultModel,
    pathToClaudeCodeExecutable: env.claudeBinPath,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    // Claude must run FRESH: load NOTHING from the filesystem — no user or
    // project settings, no CLAUDE.md injection, no skills, no hooks, no
    // plugins. The system prompt is fully owned by this harness.
    settingSources: [] as ("user" | "project" | "local")[],
    abortController: toController(input.signal),
    env: childEnv as Record<string, string | undefined>,
    maxTurns: Math.max(1, input.maxIterations),
    ...(claudeEffort(input.effort) ? { effort: claudeEffort(input.effort) } : {}),
    ...(input.system ? { systemPrompt: input.system } : {}),
    stderr: (d: string) => {
      if (process.env.MRRAWBOT_DEBUG) console.error("[claude]", d)
    },
  }

  let resultMsg: AnyMessage | undefined
  let streamed = ""

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const message of query({ prompt: input.prompt, options: options as any }) as AsyncIterable<AnyMessage>) {
    if (input.signal.aborted) break
    if (message.type === "assistant") {
      for (const block of message.message?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") {
          streamed += block.text
          input.onToken?.(block.text)
        } else if (block?.type === "tool_use") {
          input.onTool?.({ id: String(block.id ?? ""), name: String(block.name ?? "tool"), args: block.input })
        }
      }
    } else if (message.type === "result") {
      resultMsg = message
    }
  }

  if (!resultMsg) {
    if (input.signal.aborted) return { text: streamed, usage: null }
    throw new Error("claude: stream ended without a result message")
  }
  if (resultMsg.subtype && resultMsg.subtype !== "success") {
    throw new Error(`claude failed: ${resultMsg.subtype}`)
  }

  const u = resultMsg.usage ?? {}
  return {
    text: (resultMsg.result as string) || streamed,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      costUsd: resultMsg.total_cost_usd,
    },
  }
}

function toController(signal: AbortSignal): AbortController {
  const ac = new AbortController()
  if (signal.aborted) ac.abort()
  else signal.addEventListener("abort", () => ac.abort(), { once: true })
  return ac
}

interface AnyMessage {
  type: string
  subtype?: string
  result?: unknown
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: { content?: Array<{ type?: string; text?: string; id?: unknown; name?: unknown; input?: unknown }> }
}
