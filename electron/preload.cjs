// Preload: flag the renderer as running inside the native desktop shell so the
// UI can integrate with the frameless title bar (drag regions, traffic-light
// inset). Runs with contextIsolation; it only tags the shared DOM + exposes a
// tiny read-only descriptor plus the prototype-preview IPC. No Node powers are
// handed to the page.
const { contextBridge, ipcRenderer } = require("electron")

function tagPlatform() {
  const el = document.documentElement
  if (!el) return
  el.classList.add("is-electron")
  el.classList.add(
    process.platform === "darwin" ? "is-mac" : process.platform === "win32" ? "is-win" : "is-linux",
  )
}

tagPlatform()
document.addEventListener("DOMContentLoaded", tagPlatform)

try {
  contextBridge.exposeInMainWorld("mrrawbot", {
    isElectron: true,
    platform: process.platform,
    // Open a server-relative path (e.g. /api/projects/:id/preview/...) in the
    // in-app prototype browser window.
    openPreview: (path) => ipcRenderer.invoke("mrrawbot:open-preview", path),
  })
} catch {
  /* contextBridge unavailable — DOM tagging above is enough */
}
