// HTML preview helpers. Repo HTML files open through the project preview
// endpoint (Electron window or new tab); design prototypes render in the
// Design tab's embedded browser via the app-internal designs endpoint.

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

/**
 * Entry URL for a design prototype in the app-internal designs store. The
 * trailing slash matters: the server serves the slug's index.html and the
 * page's relative links resolve against the directory.
 */
export function designPreviewUrl(projectId: string, slug: string, page = ""): string {
  const encodedPage = page ? page.split("/").map(encodeURIComponent).join("/") : ""
  return `/api/projects/${projectId}/designs/${encodeURIComponent(slug)}/preview/${encodedPage}`
}

/** Pop a design page out of the embedded browser: Electron window, or a new tab on the web. */
export function openDesignExternal(url: string): void {
  if (window.mrrawbot?.openPreview) void window.mrrawbot.openPreview(url)
  else window.open(url, "_blank", "noopener")
}
