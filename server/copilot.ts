import { COPILOT_RUNTIME_PATH } from "./env.ts"
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime"
import type { RequestHandler } from "express"
import { MrrawbotAgent } from "./services/agent/MrrawbotAgent.ts"
import { MrrawbotAgentRunner } from "./services/agent/runner.ts"

/**
 * CopilotKit runtime backed by our custom in-process AG-UI agent.
 * No real LLM adapter — all generation comes from the MrrawbotAgent's emitted events.
 * The custom runner hydrates thread history from SQLite on connect, so
 * re-opened threads rebuild from the same store new runs persist into.
 */
export function makeCopilotHandler(): RequestHandler {
  const runtime = new CopilotRuntime({
    agents: {
      mrrawbot: new MrrawbotAgent({ agentId: "mrrawbot" }),
    },
    runner: new MrrawbotAgentRunner(),
  })
  const serviceAdapter = new ExperimentalEmptyAdapter()
  return copilotRuntimeNodeExpressEndpoint({
    endpoint: COPILOT_RUNTIME_PATH,
    runtime,
    serviceAdapter,
  }) as unknown as RequestHandler
}
