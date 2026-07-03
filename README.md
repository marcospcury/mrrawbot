# mrrawbot

[![Tests](https://github.com/marcospcury/mrrawbot/actions/workflows/tests.yml/badge.svg)](https://github.com/marcospcury/mrrawbot/actions/workflows/tests.yml)

A **local-first** multi-agent coding assistant. Orchestrate **Claude Code**, **Codex**, and **Ollama Cloud** agents over the git repositories on your machine, with a premium chat UI and a flexible LangGraph orchestration engine.

> Runs entirely on your computer. There is no cloud backend, no auth, and no telemetry. The only network traffic is your agents talking to their own providers.

---

## ⚠️ Full access, no permission gating

This is a personal power tool, so there is **no permission system by design**. Every agent — Claude, Codex, and Ollama — always has full access to read, modify, create, and run anything in the selected repository (Claude runs with bypassed permissions, Codex with the sandbox disabled, and the Ollama agent gets write and bash tools). Only point it at repositories you're comfortable letting an agent loose on.

---

## What it does

- **Desktop app** — runs as a native Electron window (or in the browser for dev).
- **Repo selector** — scans your home directory (depth-limited, heavy/virtual folders skipped) for git repositories, **or paste any folder path** to add a repo from anywhere.
- **Project & thread manager** — a left sidebar with a repository switcher and per-project conversation threads you can **rename**, **archive**, and **delete**.
- **Rich chat view** — CopilotKit chat with a live **agent-run timeline** showing each step, its provider/model/effort, streaming output, tool activity, cost, and duration.
- **Three providers**
  - **Claude Code** — via the Anthropic Agent SDK driving your **local `claude` CLI** (uses your existing subscription login; no API key).
  - **Codex** — via the **`codex app-server`** (uses your existing `codex login`).
  - **Ollama Cloud** — a full **LangGraph ReAct agent** with repository tools and local bash, via your Ollama Cloud API key.
- **Fully flexible orchestration** — a flow is an ordered pipeline of **self-contained steps**, and *each step independently chooses its provider, model, reasoning effort, and instructions*. Mix freely — an Ollama planner, a Claude reviewer, whatever you want — with an optional **reviewer loop-back** until approved. Reusable **agent templates** can be inserted into flows as starting points. Build it all from the UI; no code changes.
- **Single-agent quick runs are first-class** — a thread runs as one agent (provider + model + effort) by default. Flows are optional, not required.

### Reasoning effort (per step)

Every step has an **effort** control, mapped to each provider's native mechanism:

- **Claude** → `--effort` (`low | medium | high | xhigh | max`)
- **Codex** → `model_reasoning_effort` (`low | medium | high | xhigh`); **Fast** is a separate service-tier toggle when available.
- **Ollama** → `think` on/off

---

## Stack

Vite + React 19 + TypeScript · Tailwind v4 + shadcn/ui · CopilotKit (AG-UI custom agent) · LangGraph JS · Express · SQLite (better-sqlite3, raw SQL) · Vitest.

---

## Prerequisites

- **Node ≥ 22**.
- **Claude Code CLI** logged in (`claude login`) — for Claude agents.
- **Codex CLI** logged in (`codex login`) — for Codex agents.
- **Ollama Cloud API key** — for Ollama agents (get one at https://ollama.com → Settings → API keys).

Only the providers you want to use need to be set up; the app shows each provider's status in **Settings → Providers**.

---

## Install (no repo checkout needed)

Grab a packaged build from [**Releases**](https://github.com/marcospcury/mrrawbot/releases): a `.dmg` for macOS, built for both Apple Silicon (`arm64`) and Intel (`x64`). macOS only for now — on other platforms, run from source.

Two things to know:

- **Node.js 24 must be on your `PATH`.** The app runs its backend under your system Node (that's how it reuses your existing `claude`/`codex` logins and environment), and the bundled SQLite module is built for Node 24 — other Node majors won't load it. Running from source instead works with any Node ≥ 22.
- **The macOS app is unsigned** (local-first hobby project, no Apple developer certificate), so Gatekeeper will refuse to open it after download. Clear the quarantine flag once:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Mr Rawbot.app"
  ```

---

## Quick start

```bash
npm install
npm run dev      # web app at http://localhost:5173
# or
npm run app      # native Electron window
```

There is **no config file to edit** — first-run setup happens entirely in the app:

1. Launch the app and open **Settings → Providers**.
2. Each provider card shows whether it was detected. `claude` and `codex` are auto-detected from your `PATH`; if you keep them somewhere unusual, set their paths in the **Configuration** card.
3. Paste your **Ollama Cloud API key** (only needed for Ollama agents).
4. Save. Everything is stored **encrypted in the local SQLite database** and survives restarts and rebuilds.

`npm run dev` runs the Express backend (`:4000`) and the Vite dev server (`:5173`) together; Vite proxies `/api` to the backend.

### Advanced: environment variable overrides

All configuration happens in the app; these plain system environment variables exist only as power-user overrides. Values saved in Settings take precedence over them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MRRAWBOT_PORT` | `4000` | Backend port |
| `MRRAWBOT_DB` | platform app-data dir | SQLite database location |
| `MRRAWBOT_REPO_ROOTS` | `~` | Folders scanned for git repos (`:` or `,` separated) |
| `MRRAWBOT_REPO_SCAN_DEPTH` | `6` | How deep to scan for `.git` |
| `MRRAWBOT_CLAUDE_MODEL` | `claude-opus-4-8` | Default Claude model |
| `MRRAWBOT_CODEX_MODEL` | `gpt-5.5` | Default Codex model |
| `MRRAWBOT_OLLAMA_MODEL` | `qwen3-coder:480b-cloud` | Default Ollama Cloud model |
| `MRRAWBOT_CLAUDE_BIN` / `MRRAWBOT_CODEX_BIN` | auto-detected from `PATH` | Override CLI paths |
| `MRRAWBOT_CODEX_HOME` | `~/.codex` | Where Codex auth (`auth.json`) is read from. Codex always runs in an app-managed isolated `CODEX_HOME` seeded with that auth — never your real config/skills |
| `MRRAWBOT_OLLAMA_API_KEY` | — | Ollama Cloud key (normally set in Settings instead) |
| `MRRAWBOT_DEBUG` | — | `1` for verbose provider logs |

---

## Using it

1. **Add a repository** — pick one of your tracked git repos (or remove one anytime from the repo switcher).
2. **New thread** — start a conversation. Each thread remembers its history (stored in SQLite).
3. **Choose how to run** from the composer bottom row:
   - **Single agent** (the default) — pick one model; the provider is inferred, then choose effort/fast/role.
   - **A flow** — switch to any saved multi-agent pipeline (e.g. *Plan → Execute → Review*).
4. **Describe a task** — watch the agent(s) run in the live timeline and read the final answer.

Manage **Agents** and **Flows** from the sidebar footer. Built-in agents can be edited but not deleted; flows, including built-ins, can be deleted.

### Built-in flows

| Flow | Pipeline |
| --- | --- |
| Claude Code | Claude (solo) |
| Codex | Codex (solo) |
| Ollama Cloud | Ollama (solo) |
| Plan → Build | Claude *plans* → Ollama executes each plan step with fresh context and completion checks |
| Plan → Execute → Review | Claude *plans* → Ollama *executes* → Codex *reviews* (loops back to the executor until it replies `APPROVE`) |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Backend + frontend with hot reload |
| `npm run app` | Build the frontend and launch the Electron app |
| `npm run build` | Build the frontend to `dist/` |
| `npm start` | Run the backend serving the built frontend on a single port (`:4000`) |
| `npm run typecheck` | Type-check the whole project |
| `npm test` | Run the Vitest suite |

---

## Architecture

```
server/
  index.ts                  Express app: REST API + CopilotKit runtime (+ serves dist in prod)
  db/                       SQLite connection, migrations (user_version), raw-SQL repositories
  services/
    gitRepos.ts             git repository discovery
    providerSettings.ts     encrypted provider config in SQLite (paths, API key)
    providers/              claude (Agent SDK), codex (app-server), ollama (LangGraph ReAct) + repo tools
    orchestrator/engine.ts  builds a LangGraph StateGraph from a flow definition at runtime
    agent/MrrawbotAgent.ts  AG-UI agent: runs the orchestrator, streams events to CopilotKit
  api/                      REST routes (repos, projects, threads, agents, flows, providers)
shared/types.ts             types shared by server + client
src/                        React frontend (sidebar, chat panel, run timeline, dialogs)
electron/                   Electron shell (spawns the server, wraps the UI)
```

**How a run works:** the CopilotKit chat sends a message to the in-process `MrrawbotAgent`, which loads the thread's flow + agents from SQLite, assembles a LangGraph graph, and runs each agent node. Node progress is streamed back as AG-UI `STATE_SNAPSHOT` events (the live timeline) and the final answer as a text message. Messages and runs are persisted per thread.

**Extending it:** every agent is a `{ provider, model, effort, systemPrompt, role, … }` record and every flow is an ordered list of self-contained steps with optional loop-back. New roles/models are just new records; the engine assembles the graph from them. To add a new *provider*, implement a `ProviderRunner` and register it in `server/services/orchestrator/engine.ts`.

---

## Data & security notes

- Single SQLite file per user (macOS: `~/Library/Application Support/Mr Rawbot/mrrawbot.db`; elsewhere: `~/.mrrawbot/`).
- Provider config saved from the UI is encrypted at rest (AES-256-GCM) with a random key stored beside the database with `0600` permissions. This keeps secrets out of plain-text database dumps; it is not a defense against an attacker with full access to your machine.
- Claude/Codex agents use your existing CLI logins; `ANTHROPIC_API_KEY` is intentionally stripped from the Claude subprocess so it uses your subscription rather than metered API billing.

## Versioning & releases

The project follows [Semantic Versioning](https://semver.org/) with [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major). [release-please](https://github.com/googleapis/release-please) opens a release PR that bumps the version and changelog; merging it tags a GitHub release, and CI then builds and attaches the macOS/Windows/Linux installers to it (see `.github/workflows/release.yml`).

## License

[MIT](LICENSE)
