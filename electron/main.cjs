// Electron main process for mrrawbot.
//
// The backend (Express + SQLite + the agent runtime) is started as a CHILD process
// under the *system* Node via the local `tsx` binary. That keeps native modules
// (better-sqlite3) built for system Node working with zero electron-rebuild, and
// keeps the architecture identical to the web app. The renderer is just a window
// pointed at the local server (or the Vite dev server when MRRAWBOT_ELECTRON_URL is set).

const { app, BrowserWindow, Menu, nativeImage, shell } = require("electron")
const { spawn, execSync } = require("node:child_process")
const { existsSync } = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const http = require("node:http")

const ROOT = path.join(__dirname, "..")
const DEV_URL = process.env.MRRAWBOT_ELECTRON_URL || null
const PORT = process.env.MRRAWBOT_PORT || "4319"
const TARGET_URL = DEV_URL || `http://localhost:${PORT}`
const HEALTH_URL = DEV_URL || `http://localhost:${PORT}/api/health`

app.setName("Mr Rawbot")

let serverProc = null
let win = null
let quitting = false

// Apps launched from the Dock/Finder inherit a minimal environment — macOS does
// NOT source ~/.zshrc / ~/.zprofile for GUI apps. So capture the user's FULL
// interactive-login-shell environment (PATH, exported API keys, asdf/nvm setup,
// everything) and run the server with it, exactly like a terminal would.
function captureLoginShellEnv() {
  try {
    const shell = process.env.SHELL || "/bin/zsh"
    const D = "__MRR_ENV_8f3a2c__"
    // Source the user's rc files (-i interactive, -l login) then dump `env`
    // between unique delimiters so any prompt/banner noise is ignored.
    const out = execSync(`'${shell}' -ilc 'printf "%s" "${D}"; env; printf "%s" "${D}"'`, {
      encoding: "utf8",
      timeout: 9000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const start = out.indexOf(D)
    const end = out.lastIndexOf(D)
    if (start < 0 || end <= start) return null
    const env = {}
    for (const line of out.slice(start + D.length, end).split("\n")) {
      const i = line.indexOf("=")
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
    }
    return Object.keys(env).length ? env : null
  } catch {
    return null
  }
}

function resolveUserEnv() {
  const home = os.homedir()
  // Fallback PATH dirs if the shell capture fails (covers asdf/brew installs).
  const known = [
    path.join(home, ".asdf/shims"),
    path.join(home, ".asdf/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local/bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]
  const shellEnv = captureLoginShellEnv()
  // Merge the captured shell env over the (minimal) GUI env so exports win.
  const env = shellEnv ? { ...process.env, ...shellEnv } : { ...process.env }
  env.PATH = Array.from(
    new Set([env.PATH || "", process.env.PATH || "", ...known].join(":").split(":").filter(Boolean)),
  ).join(":")
  // Run the server under the same system Node that built better-sqlite3.
  let node = ""
  for (const dir of env.PATH.split(":")) {
    if (existsSync(path.join(dir, "node"))) {
      node = path.join(dir, "node")
      break
    }
  }
  return { node: node || "node", env }
}

function startBackend() {
  const { node, env: userEnv } = resolveUserEnv()
  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")
  // The DB path is resolved in server/env.ts to a stable per-user location
  // (~/Library/Application Support/Mr Rawbot), so data lives outside the bundle
  // and is shared across dev and the packaged app. Nothing to override here.
  const env = { ...userEnv, MRRAWBOT_PORT: PORT, NODE_ENV: "production" }

  serverProc = spawn(node, [tsxCli, "server/index.ts"], { cwd: ROOT, env, stdio: "inherit" })
  serverProc.on("exit", (code) => {
    serverProc = null
    if (!quitting && code) app.quit()
  })
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve((res.statusCode ?? 500) < 500)
    })
    req.on("error", () => resolve(false))
    req.setTimeout(1500, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForReady(timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await ping(HEALTH_URL)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function buildMenu() {
  // Keep a minimal native menu on macOS (for ⌘Q, copy/paste, etc.); drop it
  // entirely elsewhere so the frameless window doesn't show a menu strip.
  // Called before app "ready" so Electron skips building the default menu.
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null)
    return
  }
  const template = [{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function platformChrome() {
  if (process.platform === "darwin") {
    // Native macOS look: hide the title bar, inset the traffic lights into our header.
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 13 } }
  }
  if (process.platform === "win32") {
    // Native window-controls overlay so our header doubles as the title bar.
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#09090b", symbolColor: "#a1a1aa", height: 44 },
    }
  }
  return {} // Linux: keep the standard frame.
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#09090b",
    title: "Mr Rawbot",
    show: false,
    autoHideMenuBar: true,
    ...platformChrome(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      // Agent runs stream over SSE and must keep rendering/processing while the
      // window is hidden or minimized — don't let Chromium throttle timers.
      backgroundThrottling: false,
      // Deprecated subsystem we never use; skip loading it.
      enableWebSQL: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Avoid the white flash: reveal only once the renderer has painted.
  win.once("ready-to-show", () => win && win.show())
  win.on("closed", () => {
    win = null
  })

  await waitForReady()
  await win.loadURL(TARGET_URL).catch(() => {})
  // Safety net in case ready-to-show never fires.
  setTimeout(() => win && !win.isVisible() && win.show(), 2000)
}

buildMenu()

app.whenReady().then(async () => {
  // Dev runs (`npm run app`) aren't a real .app bundle, so set the Dock icon
  // manually; the packaged build gets it from the bundle's icns.
  if (process.platform === "darwin" && !app.isPackaged && app.dock) {
    const img = nativeImage.createFromPath(path.join(ROOT, "build", "icon.png"))
    if (!img.isEmpty()) app.dock.setIcon(img)
  }
  if (!DEV_URL) startBackend()
  await createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => app.quit())
app.on("before-quit", () => {
  quitting = true
  if (serverProc) serverProc.kill()
})
