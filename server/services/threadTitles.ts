import { HumanMessage, SystemMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages"
import { makeOllama } from "./providers/ollama.ts"

const TITLE_MODEL = "gpt-oss:120b"
const MAX_TITLE_CHARS = 70

const TITLE_SYSTEM_PROMPT = [
  "Name this coding-assistant thread.",
  "Return only a concise title, no markdown, no quotes, no punctuation-only wrapper.",
  "Use 3-8 words. Preserve important product or technical nouns.",
].join(" ")

function extractText(content: MessageContent): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : c?.type === "text" ? (c as { text?: string }).text ?? "" : ""))
      .join("")
  }
  return ""
}

export function normalizeThreadTitle(raw: string): string {
  let title = raw
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  const jsonTitle = title.match(/"title"\s*:\s*"([^"]+)"/i)?.[1]
  if (jsonTitle) title = jsonTitle

  title = title
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\d.)\s]+/, "").trim())
    .find(Boolean) ?? ""

  title = title
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[.!?:;,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (title.length > MAX_TITLE_CHARS) {
    title = title.slice(0, MAX_TITLE_CHARS).replace(/\s+\S*$/, "").trim()
  }

  return title
}

function clip(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > maxChars ? `${clean.slice(0, maxChars).trim()}…` : clean
}

export async function generateThreadTitle(input: {
  task: string
  history: string
  finalAnswer: string
  signal: AbortSignal
}): Promise<string> {
  const llm = makeOllama(TITLE_MODEL, 0, false)
  const prompt = [
    input.history.trim() ? `Conversation so far:\n${clip(input.history, 2000)}` : "",
    `Latest user request:\n${clip(input.task, 2000)}`,
    `Assistant result:\n${clip(input.finalAnswer, 2000)}`,
  ]
    .filter(Boolean)
    .join("\n\n")

  const message = (await llm.invoke(
    [new SystemMessage(TITLE_SYSTEM_PROMPT), new HumanMessage(prompt)],
    { signal: input.signal },
  )) as BaseMessage

  return normalizeThreadTitle(extractText(message.content))
}
