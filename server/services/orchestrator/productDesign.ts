// Interactive Product Design turns: the Product Specialist and Product/UI
// Designer collaborate in one conversation, producing app-internal artifacts
// (specs, prototypes, build prompts) instead of repository changes. This is
// deliberately NOT a flow — each user turn routes to the right persona (or
// both) and runs plain imperative provider calls with the same event contract
// as the flow engine.
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages"
import type {
  ArtifactInfo,
  Effort,
  ProductDesignPersona,
  Provider,
  SessionConfig,
} from "@shared/types.ts"
import { listArtifacts } from "../../db/repos/artifacts.ts"
import { runClaude } from "../providers/claude.ts"
import { runCodex } from "../providers/codex.ts"
import { makeOllama, runOllama } from "../providers/ollama.ts"
import type { ProviderRunner } from "../providers/types.ts"
import { resolveRolePrompt, roleSkillDirs } from "../roles/index.ts"
import type { Emit } from "./events.ts"

const RUNNERS: Record<Provider, ProviderRunner> = {
  claude: runClaude,
  codex: runCodex,
  ollama: runOllama,
}

type Persona = "specialist" | "designer"
type Route = Persona | "both"

const PERSONAS: Record<Persona, { stepId: string; title: string; role: string }> = {
  specialist: { stepId: "specialist", title: "Product Specialist", role: "product-specialist" },
  designer: { stepId: "designer", title: "UI Designer", role: "ui-designer" },
}

const SPECIALIST_DIRECTIVE =
  "You are the PRODUCT SPECIALIST in this product-discovery conversation. This is an interactive session, not a one-shot deliverable: " +
  "keep your turn focused on the user's latest message, and when requirements are ambiguous, ask the clarifying questions and stop — " +
  "the user answers in the next turn. When the direction is clear, capture it in the spec artifact (create or update " +
  "`<workspace>/specs/<kebab-slug>.md`, first line an `# H1` title). When the user asks for a build prompt — or a spec is clearly " +
  "build-ready and you judge it useful — write a self-contained build prompt to `<workspace>/prompts/<kebab-slug>.md`. " +
  "Iterate on existing artifacts rather than forking new slugs unless the user asks for something new. " +
  "Always end your reply by naming the artifact file(s) you created or updated (or say you changed none). " +
  "The repository is strictly read-only reference material — never create, modify, or delete anything inside it."

const DESIGNER_DIRECTIVE =
  "You are the PRODUCT/UI DESIGNER in this product-discovery conversation. This is an interactive session, not a one-shot deliverable: " +
  "keep your turn focused on the user's latest message, and when the visual direction is ambiguous, ask the clarifying questions and stop — " +
  "the user answers in the next turn. When there is enough direction, create or revise the HTML/CSS prototype in your workspace " +
  "(`<workspace>/<kebab-slug>/` with an index.html entry; iterate in place rather than forking new slugs unless asked). " +
  "Always end your reply by naming the prototype folder(s) you created or updated (or say you changed none). " +
  "The repository is strictly read-only reference material — never create, modify, or delete anything inside it."

// Cheap, deterministic routing first; only clearly mixed/ambiguous turns pay
// for an LLM classification.
const DESIGNER_HINTS =
  /\b(prototype|mock-?up|wireframe|screen|layout|visual|design the|redesign|html|css|page design|ui for|look and feel|style|theme|component library)\b/i
const SPECIALIST_HINTS =
  /\b(spec|scope|requirement|user stor(y|ies)|acceptance criteria|prd|feature|prioriti[sz]e|edge case|build prompt|prompt for|roadmap|discovery|problem statement)\b/i

function heuristicRoute(message: string): Route | null {
  const designer = DESIGNER_HINTS.test(message)
  const specialist = SPECIALIST_HINTS.test(message)
  if (designer && specialist) return "both"
  if (designer) return "designer"
  if (specialist) return "specialist"
  return null
}

const ROUTER_MODEL = "gpt-oss:120b"
const ROUTER_SYSTEM_PROMPT = [
  "You route a user's message in a product-discovery chat to the right persona.",
  "specialist = product thinking: requirements, scope, specs, user stories, acceptance criteria, build prompts.",
  "designer = visual work: HTML/CSS prototypes, screens, layout, styling.",
  "both = the message clearly needs spec work AND new/updated visuals.",
  'Answer with exactly one word: "specialist", "designer", or "both".',
].join(" ")

async function llmRoute(message: string, signal: AbortSignal): Promise<Route | null> {
  try {
    const llm = makeOllama(ROUTER_MODEL, 0, false)
    const reply = (await llm.invoke(
      [new SystemMessage(ROUTER_SYSTEM_PROMPT), new HumanMessage(message.slice(0, 2000))],
      { signal },
    )) as BaseMessage
    const text = (typeof reply.content === "string" ? reply.content : "").toLowerCase()
    if (text.includes("both")) return "both"
    if (text.includes("designer")) return "designer"
    if (text.includes("specialist")) return "specialist"
    return null
  } catch {
    return null
  }
}

export async function routeTurn(input: {
  message: string
  persona: ProductDesignPersona
  signal: AbortSignal
}): Promise<Route> {
  if (input.persona !== "auto") return input.persona
  const heuristic = heuristicRoute(input.message)
  if (heuristic) return heuristic
  return (await llmRoute(input.message, input.signal)) ?? "specialist"
}

function artifactInventory(artifacts: ArtifactInfo[], workspace: string): string {
  if (artifacts.length === 0) {
    return "# Existing artifacts\nNone yet — this project has no Product Design artifacts."
  }
  const byKind = { spec: "Specs", prototype: "Prototypes", prompt: "Build prompts" } as const
  const lines = artifacts.map((a) => {
    const location =
      a.kind === "prototype"
        ? `${workspace}/${a.slug}/`
        : `${workspace}/${a.kind === "spec" ? "specs" : "prompts"}/${a.slug}.md`
    return `- [${byKind[a.kind]}] "${a.title}" — ${location}`
  })
  return `# Existing artifacts\nArtifacts already in this project's workspace (read them before creating new ones; prefer iterating in place):\n${lines.join("\n")}`
}

function workspaceContract(workspace: string): string {
  return (
    `# Artifact workspace\nYour workspace is ${workspace} — an app-managed folder outside the repository; the user browses it in the app's Artifacts tab.\n` +
    `- Specs: ${workspace}/specs/<kebab-slug>.md (markdown, first line an \`# H1\` title)\n` +
    `- Build prompts: ${workspace}/prompts/<kebab-slug>.md (markdown, first line an \`# H1\` title)\n` +
    `- Prototypes: ${workspace}/<kebab-slug>/ with an index.html entry (never inside specs/ or prompts/)`
  )
}

export interface ProductDesignTurnInput {
  projectId: string
  repoPath: string
  repoName: string
  uploadsDir?: string
  /** App-internal artifacts folder for the project (`env.artifactsRoot/<projectId>`). */
  artifactsWorkspace: string
  session: SessionConfig
  persona: ProductDesignPersona
  task: string
  history: string
  emit: Emit
  signal: AbortSignal
  runners?: Partial<Record<Provider, ProviderRunner>>
}

function buildPersonaPrompt(input: ProductDesignTurnInput, persona: Persona, specialistOutput?: string): string {
  const sections: string[] = []
  sections.push(`# Your job in this turn\n${persona === "specialist" ? SPECIALIST_DIRECTIVE : DESIGNER_DIRECTIVE}`)
  if (input.history.trim()) sections.push(`# Conversation so far\n${input.history.trim()}`)
  sections.push(`# The user's message\n${input.task.trim()}`)
  if (specialistOutput?.trim()) {
    sections.push(`# The Product Specialist's take on this message (same turn)\n${specialistOutput.trim()}`)
  }
  sections.push(artifactInventory(listArtifacts(input.projectId), input.artifactsWorkspace))
  sections.push(workspaceContract(input.artifactsWorkspace))
  sections.push(
    `# Repository context\nThe product's repository is "${input.repoName}" at ${input.repoPath}. Read anything in it to ground your work — domain vocabulary, existing screens, design tokens — but treat it as strictly read-only.`,
  )
  return sections.join("\n\n")
}

async function runPersona(input: ProductDesignTurnInput, persona: Persona, specialistOutput?: string): Promise<string> {
  const meta = PERSONAS[persona]
  const runner = input.runners?.[input.session.provider] ?? RUNNERS[input.session.provider]
  const { provider, model, fast } = input.session
  const effort: Effort | null = input.session.effort
  input.emit({
    type: "step_start",
    stepId: meta.stepId,
    iteration: 1,
    title: meta.title,
    provider,
    model,
    effort,
  })
  if (input.signal.aborted) {
    input.emit({ type: "step_end", stepId: meta.stepId, status: "error", error: "cancelled" })
    return ""
  }
  try {
    const result = await runner({
      prompt: buildPersonaPrompt(input, persona, specialistOutput),
      system: resolveRolePrompt(meta.role, provider),
      model,
      effort,
      fast: fast ?? false,
      cwd: input.repoPath,
      uploadsDir: input.uploadsDir,
      workspaceDir: input.artifactsWorkspace,
      skillDirs: roleSkillDirs(meta.role),
      // Generous turn budget for Claude/Codex; the Ollama loop runs until done regardless.
      maxIterations: 100,
      temperature: null,
      signal: input.signal,
      onToken: (text) => input.emit({ type: "token", stepId: meta.stepId, text }),
      onLog: (text) => input.emit({ type: "log", stepId: meta.stepId, text }),
      onTool: (tool) => input.emit({ type: "tool", stepId: meta.stepId, tool }),
    })
    const text = result.text?.trim() ? result.text : "(no output)"
    input.emit({ type: "step_output", stepId: meta.stepId, text })
    input.emit({ type: "step_end", stepId: meta.stepId, status: "done", usage: result.usage })
    return text
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    input.emit({ type: "step_end", stepId: meta.stepId, status: "error", error: message })
    throw new Error(`${meta.title} failed: ${message}`)
  }
}

/** Run one Product Design turn; returns the reply shown as the assistant message. */
export async function runProductDesignTurn(input: ProductDesignTurnInput): Promise<string> {
  const route = await routeTurn({ message: input.task, persona: input.persona, signal: input.signal })
  if (route === "specialist" || route === "designer") {
    return runPersona(input, route)
  }
  const specialistOutput = await runPersona(input, "specialist")
  if (input.signal.aborted) return specialistOutput
  const designerOutput = await runPersona(input, "designer", specialistOutput)
  return [`## Product Specialist\n${specialistOutput}`, `## UI Designer\n${designerOutput}`].join("\n\n")
}
