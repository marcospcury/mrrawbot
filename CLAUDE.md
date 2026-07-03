# mrrawbot — hard constraints (read first)

Durable requirements from the owner. Do not regress these, even if a summary loses them.

- **Local-first, no .env file.** The app runs entirely on the user's machine. No telemetry, no auth, no multi-user, no hosted service. All setup happens in the UI: provider config (CLI paths, Ollama API key) lives encrypted in the SQLite settings table. Plain `MRRAWBOT_*` system environment variables are power-user overrides only — never reintroduce dotenv or a `.env` file, and never hardcode paths or values specific to one machine.
- **NO permissioning. Ever.** Every agent and every model always has **full access to everything** — read, write, create, execute. There is no "write access" flag, no read-only mode, no sandbox, no permission toggle anywhere in the UI, data model, or providers. (Claude runs with bypassed permissions, Codex with `danger-full-access`, Ollama always gets write and bash tools.)
- **Single-agent quick run is first-class.** A thread runs as one agent (provider + model + effort) by default — flows are optional, not required. "Not everything is a flow."
- **No artificial turn limits on the Ollama agent loop.** It runs until the model is done (stops calling tools), with only a high safety ceiling to avoid infinite loops.
- **Repo discovery must skip virtual/VM mounts** (OrbStack, containers, etc.) — never scan those.
- **Build the whole scope; no MVPs.** Have good taste in the UI; the Electron app should feel like a real native app, not a browser shell.

## Stack / commands
- Single ESM Node package. Express backend (`tsx`) + Vite/React 19 frontend; Electron wraps it.
- `npm run dev` (web), `npm run app` (Electron), `npm run typecheck`, `npm test`.
- SQLite via better-sqlite3, **raw SQL only (no ORM)**. Migrations are append-only in `server/db/db.ts`.
- Server runtime-value imports from `@shared/*` require the path mapping in the **root** `tsconfig.json` (tsx reads that one).
