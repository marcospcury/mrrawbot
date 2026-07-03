// Prototype preview: renders repo HTML files (e.g. the UI designer role's
// `design/prototypes` output) through the server's static preview endpoint.
// Inside Electron the page opens in the in-app prototype browser window (via
// the preload bridge); in the web app it opens in a new tab.

declare global {
  interface Window {
    mrrawbot?: {
      isElectron: boolean
      platform: string
      openPreview?: (path: string) => Promise<void>
    }
  }
}

export function isPreviewable(path: string): boolean {
  return /\.html?$/i.test(path)
}

export function previewUrl(projectId: string, filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/")
  return `/api/projects/${projectId}/preview/${encoded}`
}

export function openPreview(projectId: string, filePath: string): void {
  const url = previewUrl(projectId, filePath)
  if (window.mrrawbot?.openPreview) void window.mrrawbot.openPreview(url)
  else window.open(url, "_blank", "noopener")
}
