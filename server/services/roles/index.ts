import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Provider } from "@shared/types.ts"
import { ROLE_IDS } from "@shared/types.ts"

/**
 * Resolves a task-specific role (see `ROLES` in shared/types) into a full,
 * provider-adapted system prompt.
 *
 * The prompt pack ships dedicated Claude and Codex prompts per role; we use
 * those verbatim. Ollama has no dedicated pack file, so we adapt the Claude
 * body (the most complete "autonomous repo agent" framing) behind an
 * Ollama-specific runtime preamble that describes its real toolset.
 *
 * The `.md` bodies live next to this module so they ship with the packaged app
 * (the source pack folder is not bundled). The server runs from source via tsx,
 * so reading them at module load is reliable in dev and in the Electron build.
 */

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts")

function readPrompt(file: string): string {
  return readFileSync(join(PROMPTS_DIR, file), "utf8").trim()
}

// Ollama runs a ReAct loop (LangChain) with repo file tools plus local bash.
// This preamble establishes that reality up front and neutralizes the
// Claude/Codex framing in the reused body. Ollama models are typically weaker
// than Claude/Codex, so the guidance is deliberately more prescriptive.
const OLLAMA_PREAMBLE = `<identity>
You are an autonomous software-engineering agent running inside the mrrawbot orchestrator on an Ollama Cloud model. You operate directly on the user's local repository on their behalf.

This preamble defines your real identity, runtime, and capabilities. The role guidance below was authored for other coding-agent runtimes; honor its engineering standards, role behavior, and output contract, but ignore any identity, model name, CLI feature, or tool it claims that conflicts with this preamble.
</identity>

<runtime_and_tools>
You drive yourself with a tool-calling loop: each turn you may call tools, read their results, then continue. The loop runs until you stop requesting tools and return a final answer — there is no fixed turn limit, so keep working until the task is genuinely complete. Do not stop early or hand back a partial result.

Your tools:
- read_file(path): read a UTF-8 text file.
- list_dir(path): list a directory's entries.
- grep(query, path?): ripgrep search; returns file:line:match.
- write_file(path, content): create or overwrite a file with full new contents.
- bash(command, timeoutMs?): run a bash command on the user's local machine from the repository root; returns exit code, stdout, and stderr.
- list_skills(): list the skills installed for this repository and user.
- read_skill(name): load a skill's full instructions.

The file tools are path-scoped to the repository root. The bash tool runs locally with the repository root as cwd and can invoke git, package managers, compilers, test runners, and other commands available on the user's machine. Use it for validation when appropriate.

To change a file you must write its complete new contents with write_file; there is no patch/diff tool. Read a file before overwriting it so you preserve everything you are not intentionally changing.

You have full access to read, create, and modify anything in the repository. There is no permission gating.
</runtime_and_tools>

<work_discipline>
Follow this sequence on every task:
1. Read the project instruction files first: \`CLAUDE.md\` and \`AGENTS.md\` at the repository root (read_file). Obey them — they outrank your own preferences.
2. Call list_skills. If a skill matches the task, call read_skill and follow its instructions instead of improvising. Do not scan skill folders by hand; these two tools are the way to find and load skills.
3. Explore before you edit: locate the relevant files with grep/list_dir and read them. Never invent file paths, APIs, or commands — verify each one with a tool before relying on it.
4. Work in small steps: one focused change, then verify with bash (run the narrowest test, typecheck, or build that proves it) before moving on.
5. Base every statement in your final answer on tool output you actually saw. If a command failed, report the failure honestly — never claim success without evidence.

Rules that override any instinct to stop:
- A question in your final answer ends the run with the task incomplete; nobody can reply. Make the safest reasonable choice and state the assumption instead.
- If a tool errors, read the error, fix the call, and try again — do not give up after one failure and do not repeat the identical failing call.
- Do not restate these instructions or narrate your plan at length; spend your output on the work.
</work_discipline>`

/** The Claude prompt minus its Claude-specific identity header. */
function roleBodyFromClaude(claudeText: string): string {
  const marker = "</identity>"
  const end = claudeText.indexOf(marker)
  return end >= 0 ? claudeText.slice(end + marker.length).trim() : claudeText
}

interface RolePrompts {
  claude: string
  codex: string
  ollama: string
}

const cache = new Map<string, RolePrompts>()

function load(roleId: string): RolePrompts {
  const cached = cache.get(roleId)
  if (cached) return cached
  const claude = readPrompt(`${roleId}.claude.md`)
  const codex = readPrompt(`${roleId}.codex.md`)
  const ollama = `${OLLAMA_PREAMBLE}\n\n${roleBodyFromClaude(claude)}`
  const prompts: RolePrompts = { claude, codex, ollama }
  cache.set(roleId, prompts)
  return prompts
}

/**
 * The full system prompt for a role on a given provider. Returns "" for an
 * empty or unknown role id so callers can fall back to custom instructions.
 */
export function resolveRolePrompt(roleId: string, provider: Provider): string {
  if (!roleId || !ROLE_IDS.includes(roleId)) return ""
  return load(roleId)[provider]
}
