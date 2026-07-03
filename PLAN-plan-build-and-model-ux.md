# Plan: robust plan→build flow + unified model selection + composer controls

Four changes, ordered so each lands independently. Grounded in the current code:

- Flow engine: `server/services/orchestrator/engine.ts` (LangGraph `StateGraph`, linear chain, shared `transcript` state, optional review loops).
- Quick run: `server/services/agent/MrrawbotAgent.ts:31-62` synthesizes a 1-step flow from the thread's `SessionConfig`; both paths converge on `runFlow()`.
- Model lists: `server/services/providers/status.ts` — Claude is a hardcoded 5-entry list, Codex is live (`model/list` RPC, hidden models filtered), Ollama is live `/api/tags` with a static fallback. Exposed via `GET /api/providers`.
- Selection UI: `src/components/chat-panel.tsx` (`SingleAgentControls`, 4 Selects + Fast toggle in the **header**) and `src/components/flows-dialog.tsx` (`StepCard`, provider Select + model `<datalist>`).
- Composer: stock `<CopilotChat>` (`chat-panel.tsx:120-125`), styled via `.copilotKitInputContainer` overrides in `src/index.css:212-290`. No custom Input slot yet.

---

## 1. Robust plan→build flow (fresh context per plan step + completion loop)

### Problem
Today a "builder" flow step is one provider invocation that receives the whole accumulated transcript. A big plan gets executed in a single context window: quality degrades as the window fills, and there is no check that everything in the plan actually got built.

### Design

Introduce a step execution mode on `FlowStep`:

```ts
// shared/types.ts
export type StepMode = "single" | "plan-executor"

export interface FlowStep {
  // ...existing fields...
  /**
   * "single" (default): one provider invocation, current behavior.
   * "plan-executor": treat the PREVIOUS step's output as a structured plan;
   * execute each plan step as its OWN provider invocation (fresh context),
   * then run completion-check passes until the plan is fully implemented.
   */
  mode: StepMode
}
```

No new tables. `flows.definition` is JSON; `normalizeStep()` in `server/db/repos/flows.ts` defaults `mode: "single"` for legacy steps. Append-only migration not needed (JSON column).

#### 1a. Structured plan contract (planner side)

The plan-executor needs a machine-readable plan. Add a **plan output contract** appended to the planner's system prompt *only when the next step in the flow is a plan-executor* (resolved at graph-build time in `buildFlowGraph()`):

- The planner must end its output with a fenced block:

  ````
  ```plan-json
  {
    "summary": "one-paragraph overview of the whole change",
    "steps": [
      { "id": 1, "title": "…", "prompt": "self-contained instructions for this step",
        "files": ["optional touch-list"], "verify": "how to check this step is done" }
    ]
  }
  ```
  ````

- Parser in a new `server/services/orchestrator/plan.ts`:
  - `parsePlan(text): ParsedPlan | null` — extract the last `plan-json` fenced block, `JSON.parse`, validate shape.
  - **Fallback**: if no JSON block, split on `## Step N` / `### N.` markdown headings so hand-written or non-conforming plans still work; `summary` = everything before the first heading.
  - If neither yields ≥1 step, the executor degrades gracefully: run the whole plan as a single invocation (current behavior) and log a warning to the step's log stream.

#### 1b. Per-step execution with fresh context

New node factory `makePlanExecutorNode(step, ctx)` in `engine.ts` (used by `buildFlowGraph()` when `step.mode === "plan-executor"`), replacing `makeNode` for that step. Behavior:

1. Read the plan from the previous step's output (`state.outputs[prevStepId]`; the executor knows its predecessor from the resolved step order).
2. `parsePlan()` → `{ summary, steps[] }`.
3. For each plan step **sequentially** (they build on each other in the same repo):
   - Fresh provider invocation via the step's configured runner (`RUNNERS[step.provider]`) — same model/effort/fast/role as the executor step. Each invocation is a new CLI/app-server session, so a genuinely fresh context window.
   - Prompt = exactly what the user asked for:
     ```
     # Big picture
     <plan summary>
     # Overall plan (titles only)
     1. … 2. … [current step marked]
     # Already completed
     <one-line result summary per finished step>
     # Your task — step N: <title>
     <step.prompt>
     <step.verify if present>
     # Repository context (same as buildPrompt today)
     ```
     Deliberately **not** the full transcript of prior steps — the repo itself is the shared state; only one-line completion summaries carry over.
   - Capture a short completion summary: the sub-agent is instructed to end with `DONE: <one line of what changed>`; store that line for the "Already completed" section (full output only in logs/UI).
4. **Completion loop** after all steps:
   - Run a *checker pass* with the same model: prompt = plan summary + full step list + completion summaries + "Inspect the repository. List anything from the plan that is missing or incomplete as a `plan-json` block with the same schema (empty `steps` array = fully implemented). Then implement nothing yet."
   - If the checker returns missing items → feed them back through step 3 as a new round.
   - Loop until the checker returns an empty list. Safety ceiling only (no artificial low cap, per project constraints): default `maxCompletionPasses = 10`, stored on the step (reuse a UI-editable number next to maxIterations).
5. Node returns the usual `Partial<Orch>`: `finalOutput` = checker's final confirmation + concatenated completion summaries; `transcript` gets a compact digest so downstream flow steps (e.g. a reviewer) see what was built.

#### 1c. Progress UI (sub-steps in the timeline)

The orchestrator already streams `step_start/step_output/step_end` events keyed by `stepId`, rendered by `agent-run-timeline.tsx` from `AgentRunState.steps`. Extend:

- Emit sub-steps with synthetic ids `"<stepId>#<round>.<n>"` and titles like `"Build 3/7 — Add migration"`, plus checker passes as `"Completion check (pass 2)"`.
- `MrrawbotAgent.ts` event→`RunStep` mapping: treat unknown stepIds with a `#` as dynamic children — append them to `state.steps` in order (they already carry provider/model/title). Timeline renders them as ordinary steps; optionally indent when the id contains `#` (small `agent-run-timeline.tsx` tweak).
- Verify `events.ts` `Emit` type needs no change (events are already stepId-string keyed) — only the agent's step-registry assumption ("steps are pre-declared") must be relaxed.

#### 1d. Seeding + quick access

- Add a builtin **"Plan → Build"** flow in `server/seed.ts`: step 1 = planner role (mode single), step 2 = coder role with `mode: "plan-executor"`. Builtin flows are already supported (`is_builtin`).
- Flow editor (`flows-dialog.tsx` `StepCard`): a small "Execution" select — `Single run` / `Plan executor (fresh context per plan step)` — plus the completion-pass ceiling input when plan-executor is chosen.

### Verify
- Unit tests for `parsePlan()` (JSON block, markdown fallback, garbage input) in `server/services/orchestrator/plan.test.ts`.
- Extend `engine.test.ts`: fake runner records prompts; assert a 3-step plan produces 3 fresh invocations with summary+step prompts and no full-transcript leakage; assert checker loop re-runs missing steps and terminates on empty list and on ceiling.
- Manual: run the seeded Plan → Build flow on a toy repo task; watch sub-steps stream in the timeline.

---

## 2. Every model of every provider available everywhere

### Why models are missing today (`status.ts`)
1. **Claude**: hardcoded `CLAUDE_MODELS = ["claude-fable-5", "claude-opus-4-8", "opus", "sonnet", "haiku"]` — no discovery, misses sonnet-5, haiku-4.5, dated snapshots.
2. **Codex**: live list filters `hidden: true` models (`fetchCodexCatalog`, status.ts:66) — anything flagged hidden by the app-server never reaches the UI.
3. **Ollama**: live only when `MRRAWBOT_OLLAMA_API_KEY` is set; otherwise a static snapshot. Local `ollama list` models (non-cloud) are never merged.
4. UI side: the single-agent **model Select is a closed list** (chat-panel.tsx:306-318) — if a model isn't in `providers[].models`, you can't pick it. (Flow editor's `<datalist>` already allows free text; single-agent does not.)

### Changes
- **Claude** (`status.ts`): expand the static list to the full current catalog (claude-fable-5, claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5-20251001, plus `opus/sonnet/haiku` aliases). Attempt discovery first: `claude models list --json` if the installed CLI supports it (probe once, cache; fall back to the static list). Keep `env.claudeDefaultModel` merged in.
- **Codex**: stop dropping hidden models — include them, tagged: extend the catalog mapping to `{ id, hidden, fastTier }` and surface hidden ones at the bottom of the list (see §3 grouping) rather than removing them.
- **Ollama**: merge three sources — cloud `/api/tags` (when key set), **local daemon** `http://localhost:11434/api/tags` (best-effort, 1s timeout), and the fallback snapshot. Dedupe.
- **Free-text everywhere**: both pickers (§3 combobox, flow editor) accept an arbitrary model id — "Use '<typed>'" row when the filter has no exact match. Backend already passes `model` straight through to the runners, so nothing to change server-side.
- **New unified endpoint** `GET /api/models` (add to `server/api/providers.ts`), the backbone for §3:
  ```ts
  interface ModelEntry {
    id: string          // globally unique today — asserted, see below
    provider: Provider
    available: boolean  // provider availability
    fast: boolean       // Codex fast tier
    hidden: boolean     // Codex hidden flag
    isDefault: boolean  // provider's default model
  }
  ```
  Built from `getProviderStatuses()` — one source of truth, keeps `/api/providers` for the settings screen. **Collision guard**: if the same id ever appears under two providers, suffix the entry label with the provider name and keep both (don't silently drop one); log it.

### Verify
- `curl /api/models` shows the union; every model visible in one flat list.
- Test in `status.test.ts` (new): Codex hidden models present with `hidden: true`; Ollama merge dedupes.
- Manual: type a brand-new model id in the picker and run it.

---

## 3. Simplified model selection — one flat list, provider implicit

### Design
Replace the Provider + Model pair of Selects with **one searchable combobox** fed by `GET /api/models`:

- New component `src/components/model-combobox.tsx` using the existing shadcn primitives (`Popover` + `Command` from `components/ui`; add `command.tsx` via shadcn if not present — `components.json` exists).
- Each row: provider dot (existing `PROVIDER_DOT` colors) + model id; unavailable providers' models greyed with a hint ("Codex: run `codex login`"); Codex fast-tier models get a small ⚡ suffix; hidden models sorted last under a "More" divider.
- Text input filters by substring. No exact match → "Use '<typed>' (pick provider ▸)" row (provider needed only in this edge case, defaults to Claude).
- **Selecting a model sets the provider implicitly.** New helper in `src/lib/models.ts`: `resolveProvider(modelId, catalog): Provider`. On selection: update `session.provider` + `session.model` in one `setSession` call, clamp `effort` via `effortsFor(newProvider)` (same logic as `changeProvider` today, chat-panel.tsx:164-169), drop `fast` when leaving Codex.
- Frontend query: add `useModels()` to `src/lib/queries.ts` (60s refetch like `useProviders`).

### Where it applies
- Single-agent controls (moving to composer in §4) — combobox replaces the Provider and Model Selects.
- Flow editor `StepCard` — replace the provider Select + model datalist pair with the same combobox; `provider` field on the step is written from the resolved provider. (Keep the field in the data model — runners need it.)
- `AgentConfig` templates in `agents-dialog.tsx` — same swap, same component.

### Verify
- Typecheck + `npm test`.
- Manual: filter "kimi" → pick → provider dot flips to violet, effort options collapse to Ollama's pair; filter "gpt-5.5" → provider flips to Codex, Fast toggle appears when applicable.

---

## 4. Move model / effort / speed / role into the composer bottom row (compact)

### Approach
CopilotKit's `<CopilotChat>` accepts component overrides — pass a custom **`Input`** component (verify exact prop name/signature against the installed `@copilotkit/react-ui` version; it receives `inProgress`, `onSend`, and stop handling). Build:

- `src/components/composer.tsx` — custom input:
  - **Row 1**: auto-growing textarea, Enter=send / Shift+Enter=newline, placeholder "Describe a coding task…". Send / Stop button at the right (Stop replaces Send while `inProgress` — the header Stop button in `chat-panel.tsx:110-115` moves here).
  - **Row 2 (bottom row, compact pills)** — harness style, icon-first, popover-based, ordered:
    1. **Mode/flow pill** — ⚡ `Single` / 🔀 `<flow name>` (the existing DropdownMenu from `RunConfigBar` relocated). When a flow is active, pills 2-5 hide (flow steps own their config) and the provider-chain pills render instead.
    2. **Model pill** — provider dot + model short-name (strip vendor prefixes/`:cloud` suffix for display, full id in tooltip). Opens the §3 combobox in a popover.
    3. **Effort pill** — 🧠 + level (`low/medium/high/xhigh/max`; Ollama shows `think on/off`). Cycles on click through `effortsFor(provider)` including "default", with a right-click/long-press… no — keep it a small popover list (discoverable, no hidden gestures).
    4. **Speed pill** — ⚡ `Fast`, Codex-only, only when the selected model is in `fastModels`; toggle on click; amber when active (reuse current styling, chat-panel.tsx:347-350).
    5. **Role pill** — 🎭 + role name, popover with the 5 roles + descriptions.
  - Pills: `h-6`, `text-[11px]`, `rounded-full border px-2 gap-1`, muted-foreground, accent on hover — visually quiet like Claude Code / Cursor bottom bars.
- **Wiring**: `RunConfigBar` state logic (`setSession`, `changeProvider`, flow selection, `onChangeRun`) extracts into a hook `useRunConfig(thread, flows, onChangeRun)` so composer and any remaining header UI share it. `ChatPanel` passes the composer via the Input override; the header keeps only the sidebar trigger + editable title (and gets visually lighter).
- **Styling**: the custom input lives inside `.copilotKitInputContainer`, which is already width-constrained/centered in `index.css` — extend those scoped overrides for the two-row layout (note: CopilotKit exposes no typography vars; keep using scoped CSS as today).
- **Persistence**: unchanged — session edits still flow through `onChangeRun` → `PATCH /threads/:id` (`session` JSON column).

### Verify
- Manual (primary, it's UI): `npm run dev` — send messages, switch models mid-thread, toggle fast, switch to a flow (pills collapse to flow chain), stop a running generation from the composer, confirm persisted config survives reload. Then `npm run app` to confirm the Electron layout (narrow widths: pills wrap or overflow-scroll horizontally, no clipping).
- Typecheck for the CopilotKit override signature.

---

## Suggested order & effort

| Phase | Item | Size | Depends on |
|---|---|---|---|
| 1 | §2 model catalog + `/api/models` | S | — |
| 2 | §3 model combobox (flow editor + agents dialog first) | M | 1 |
| 3 | §4 composer with bottom-row pills | M | 2 |
| 4 | §1 plan-executor mode + completion loop + seeded flow | L | — (parallel-safe) |

Each phase ships alone: typecheck + `npm test` + manual run gate each one.

## Open questions (defaults chosen, flag if wrong)
1. **Plan sub-steps run sequentially** (they mutate one repo). Parallel fan-out over worktrees is out of scope — local-only app, and steps usually depend on each other.
2. **Completion-pass ceiling defaults to 10** and is user-editable per step; it's a runaway guard, not a turn limit.
3. **Checker uses the same model as the builder** (per your description). A later tweak could allow a different checker model — the step already carries full model config, so this stays open cheaply.
4. **Effort/speed for plan sub-steps** inherit the executor step's config; no per-sub-step overrides.
5. Header retains the thread title only; if you'd rather keep the flow picker in the header instead of the composer, that's a 5-minute move.
