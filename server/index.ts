import { existsSync } from "node:fs"
import path from "node:path"
import cors from "cors"
import express, { type ErrorRequestHandler } from "express"
import { makeApiRouter } from "./api/index.ts"
import { HttpError } from "./api/_util.ts"
import { makeCopilotHandler } from "./copilot.ts"
import "./db/db.ts" // runs migrations on import
import { COPILOT_RUNTIME_PATH, env, ROOT_DIR } from "./env.ts"
import { seedDefaults } from "./seed.ts"
import { loadProviderSettings } from "./services/providerSettings.ts"

seedDefaults()
loadProviderSettings()

const app = express()
app.use(cors())
app.use(express.json({ limit: "16mb" }))

// CopilotKit runtime (custom in-process agent). The handler's internal Hono router
// matches the FULL request path against its basePath (COPILOT_RUNTIME_PATH), so we
// must NOT use `app.use(path, ...)` (which strips the prefix from req.url). Instead we
// mount at root and guard by path, preserving req.url for the handler.
const copilotHandler = makeCopilotHandler()
app.use((req, res, next) => {
  if (req.path === COPILOT_RUNTIME_PATH || req.path.startsWith(`${COPILOT_RUNTIME_PATH}/`)) {
    void copilotHandler(req, res, next)
    return
  }
  next()
})

// REST API.
app.use("/api", makeApiRouter())

// Serve the built frontend in production for a single-port experience.
const distDir = path.join(ROOT_DIR, "dist")
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next()
    res.sendFile(path.join(distDir, "index.html"))
  })
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500
  if (status >= 500) console.error("[mrrawbot]", err)
  res.status(status).json({ error: (err as Error)?.message ?? "Internal error" })
}
app.use(errorHandler)

app.listen(env.port, () => {
  console.log(`\n  mrrawbot server  →  http://localhost:${env.port}`)
  console.log(`  copilot runtime  →  http://localhost:${env.port}${COPILOT_RUNTIME_PATH}`)
  console.log(`  database         →  ${env.dbPath}`)
  console.log(`  repo roots       →  ${env.repoRoots.join(", ") || "(none found)"}\n`)
})
