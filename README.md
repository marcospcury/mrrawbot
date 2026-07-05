# Mr Rawbot

[![Tests](https://github.com/marcospcury/mrrawbot/actions/workflows/tests.yml/badge.svg)](https://github.com/marcospcury/mrrawbot/actions/workflows/tests.yml)

Mr Rawbot is a desktop app for running AI coding agents against the repositories on your machine. It wraps Claude Code, Codex, and Ollama Cloud in a single interface: you pick a repo, open a thread, and either run one agent directly or chain several into a flow (plan, build, review). The app shows the conversation, a timeline of each run step, file diffs, and generated artifacts side by side.

Everything runs locally. There is no hosted backend, no account, no telemetry, and no `.env` file — provider configuration lives encrypted in a local SQLite database and is managed entirely from the UI.

## What it does

- Discovers git repositories on your machine, or works against any folder path you give it.
- Runs a single agent per thread by default: choose provider, model, reasoning effort, and role, then send the task.
- Optionally runs multi-agent flows — sequences of steps, each with its own provider, model, and instructions.
- Records each run: steps, durations, token usage, cost, logs, and status.
- Shows the working tree next to the chat: file browser, per-run changes, and diffs.

## Safety model

There is no permission system, on purpose. Every agent can read, write, create, and execute inside the selected repository: Claude runs with bypassed permissions, Codex runs with sandboxing disabled, and Ollama gets write tools plus local bash. Mr Rawbot is a personal power tool — only point it at repositories you're comfortable letting an agent modify.

## Providers

| Provider | How it's used |
| --- | --- |
| Claude Code | Runs your local `claude` CLI through the Anthropic Agent SDK. Uses your existing subscription login, not an API key. |
| Codex | Runs through `codex app-server` using your existing `codex login`. |
| Ollama Cloud | Runs a LangGraph ReAct coding agent with repository tools and local bash. Requires an Ollama Cloud API key. |

Configure only the providers you want. Availability and model lists appear in **Settings → Providers**.

## Built-in flows

| Flow | What it does |
| --- | --- |
| Claude Code | A single Claude run from start to finish. |
| Codex | A single Codex run with medium reasoning effort. |
| Ollama Cloud | A single Ollama Cloud coding agent with repository tools. |
| Plan → Build | Claude plans; Ollama executes the plan step by step with completion checks. |
| Heavy Plan → Build | Claude writes a more exhaustive plan before Ollama executes. |
| Plan → Execute → Review | Claude plans; Ollama implements; Codex reviews and loops back until `APPROVE`. |
| Ollama Plan → Codex Build | Ollama plans; Codex implements. |

## Install

Download the latest build from [Releases](https://github.com/marcospcury/mrrawbot/releases). macOS builds ship as `.dmg` artifacts for Apple Silicon and Intel; other platforms run from source.

Two macOS notes:

- **Node.js 24 must be on your `PATH`.** The packaged app starts its backend with your system Node so it can reuse your existing `claude` and `codex` logins.
- **The app is unsigned**, so Gatekeeper may block first launch. Clear quarantine once:

```bash
xattr -dr com.apple.quarantine "/Applications/Mr Rawbot.app"
```

## Run from source

```bash
npm install
npm run dev      # web app at http://localhost:5173
# or
npm run app      # native Electron window
```

First-run setup happens in the app: open **Settings → Providers**, confirm `claude` and `codex` were detected (or set custom CLI paths), add an Ollama Cloud API key if you want Ollama runs, and save. Values are stored encrypted in the local SQLite database.

## Configuration

There is no `.env` file; the UI is the source of truth. `MRRAWBOT_*` environment variables exist only as power-user overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MRRAWBOT_PORT` | `4000` | Backend port. |
| `MRRAWBOT_DB` | platform app-data directory | SQLite database path. |
| `MRRAWBOT_REPO_ROOTS` | `~` | Repo scan roots, separated by `:` or `,`. |
| `MRRAWBOT_REPO_SCAN_DEPTH` | `6` | Maximum depth for repo discovery. |
| `MRRAWBOT_CLAUDE_MODEL` | `claude-opus-4-8` | Default Claude model. |
| `MRRAWBOT_CODEX_MODEL` | `gpt-5.5` | Default Codex model. |
| `MRRAWBOT_OLLAMA_MODEL` | `qwen3-coder:480b-cloud` | Default Ollama Cloud model. |
| `MRRAWBOT_CLAUDE_BIN` / `MRRAWBOT_CODEX_BIN` | auto-detected from `PATH` | Override CLI paths. |
| `MRRAWBOT_CODEX_HOME` | `~/.codex` | Source for Codex `auth.json`; runtime uses an isolated app-managed Codex home. |
| `MRRAWBOT_OLLAMA_API_KEY` | — | Ollama Cloud key, normally saved through Settings instead. |
| `MRRAWBOT_DEBUG` | — | Set `1` for verbose provider logs. |

## Developer commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the backend and Vite frontend with hot reload. |
| `npm run app` | Build the frontend and launch Electron. |
| `npm run build` | Build the frontend to `dist/`. |
| `npm start` | Serve the built app from the backend on one port. |
| `npm run typecheck` | Type-check the full project. |
| `npm test` | Run the Vitest suite. |

## Architecture

Single ESM Node package: Electron shell, Vite/React frontend, Express backend, SQLite persistence (raw SQL, no ORM), CopilotKit chat runtime, and LangGraph orchestration. Runs are persisted per thread — the chat streams agent state snapshots into the UI while the backend stores messages, run timelines, flows, provider settings, artifacts, and per-run file changes.

Provider settings saved in the UI are encrypted at rest with AES-256-GCM. The key lives beside the database with restrictive file permissions — this guards against accidental plain-text dumps, not against someone who already controls your machine.

## Releases

Semantic Versioning via Conventional Commits: `feat:` is a minor release, `fix:` is a patch, and breaking changes use `feat!`, `fix!`, or a `BREAKING CHANGE:` footer. release-please opens version/changelog PRs, and CI builds artifacts after tags are created.

## License

[MIT](LICENSE)
