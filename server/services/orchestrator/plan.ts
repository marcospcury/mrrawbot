export interface ParsedPlanStep {
  id: number
  title: string
  prompt: string
  files: string[]
  verify: string
}

export interface ParsedPlan {
  summary: string
  steps: ParsedPlanStep[]
}

export const PLAN_OUTPUT_CONTRACT = `End your response with a fenced \`plan-json\` block that matches this schema exactly:

\`\`\`plan-json
{
  "summary": "one-paragraph overview of the whole change",
  "steps": [
    {
      "id": 1,
      "title": "short step title",
      "prompt": "self-contained instructions for this step",
      "files": ["optional touch-list"],
      "verify": "how to check this step is done"
    }
  ]
}
\`\`\`

Keep the plan step prompts self-contained.`

export function parsePlan(text: string): ParsedPlan | null {
  return parseJsonPlan(text) ?? parseMarkdownPlan(text)
}

function parseJsonPlan(text: string): ParsedPlan | null {
  const blocks = [...text.matchAll(/```plan-json\s*([\s\S]*?)```/gi)]
  const last = blocks.at(-1)?.[1]
  if (!last) return null
  try {
    return normalizePlan(JSON.parse(last))
  } catch {
    return null
  }
}

function normalizePlan(raw: unknown): ParsedPlan | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.steps)) return null
  const steps = obj.steps
    .map((step, index) => normalizeStep(step, index))
    .filter((step): step is ParsedPlanStep => step !== null)
  if (steps.length === 0 && obj.steps.length > 0) return null
  return {
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
    steps,
  }
}

function normalizeStep(raw: unknown, index: number): ParsedPlanStep | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const title = typeof obj.title === "string" ? obj.title.trim() : ""
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : ""
  if (!title && !prompt) return null
  return {
    id: Number.isFinite(Number(obj.id)) ? Number(obj.id) : index + 1,
    title: title || `Step ${index + 1}`,
    prompt: prompt || title,
    files: Array.isArray(obj.files) ? obj.files.map(String).filter(Boolean) : [],
    verify: typeof obj.verify === "string" ? obj.verify.trim() : "",
  }
}

function parseMarkdownPlan(text: string): ParsedPlan | null {
  const headingRe = /^(#{2,3})\s*(?:Step\s*)?(\d+)[.):\-\s]+(.+)$/gim
  const matches = [...text.matchAll(headingRe)]
  if (matches.length === 0) return null

  const steps: ParsedPlanStep[] = []
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length
    const prompt = text.slice(start, end).trim()
    const title = match[3].trim()
    steps.push({
      id: Number(match[2]),
      title,
      prompt: prompt || title,
      files: [],
      verify: "",
    })
  }

  return {
    summary: text.slice(0, matches[0].index ?? 0).trim(),
    steps,
  }
}
