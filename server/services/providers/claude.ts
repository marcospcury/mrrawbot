import { spawn } from "node:child_process"
import type { Effort } from "@shared/types.ts"
import { env } from "../../env.ts"
import type { ProviderRunInput, ProviderRunOutput } from "./types.ts"

// Claude Code effort matches our levels exactly: low | medium | high | xhigh | max.
function claudeEffort(effort: Effort | null): Effort | undefined {
  return effort ?? undefined
}

/**
 * Run Claude Code as a one-shot agent via the local CLI (subscription auth),
 * spawned directly with `--print --output-format stream-json` — no Agent SDK.
 * Captures the final result text + token/cost usage.
 */
export async function runClaude(input: ProviderRunInput): Promise<ProviderRunOutput> {
  // Strip ANTHROPIC_API_KEY so the spawned CLI uses the user's subscription login
  // rather than pay-per-token API billing.
  const { ANTHROPIC_API_KEY: _drop, ...childEnv } = process.env

  const args = [
    "--print",
    "--output-format",
    "stream-json",
    // stream-json output in print mode requires verbose.
    "--verbose",
    // NO permissioning, ever: full access to everything.
    "--dangerously-skip-permissions",
    // Claude must run FRESH: load NOTHING from the filesystem — no user or
    // project settings, no CLAUDE.md injection, no skills, no hooks, no
    // plugins. The system prompt is fully owned by this harness.
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--model",
    input.model || env.claudeDefaultModel,
  ]
  const effort = claudeEffort(input.effort)
  if (effort) args.push("--effort", effort)
  if (input.system) args.push("--system-prompt", input.system)

  const child = spawn(env.claudeBinPath, args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv as NodeJS.ProcessEnv,
  })
  input.signal.addEventListener("abort", () => child.kill(), { once: true })
  child.stdin.write(input.prompt)
  child.stdin.end()

  child.stderr.on("data", (d) => {
    if (process.env.MRRAWBOT_DEBUG) console.error("[claude]", String(d))
  })

  let resultMsg: AnyMessage | undefined
  let streamed = ""
  let buf = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString()
    let nl: number
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let message: AnyMessage
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
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
  })

  const code: number = await new Promise((res) => child.on("close", res))

  if (!resultMsg) {
    if (input.signal.aborted) return { text: streamed, usage: null }
    throw new Error(`claude: stream ended without a result message (exit ${code})`)
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

interface AnyMessage {
  type: string
  subtype?: string
  result?: unknown
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  message?: { content?: Array<{ type?: string; text?: string; id?: unknown; name?: unknown; input?: unknown }> }
}
