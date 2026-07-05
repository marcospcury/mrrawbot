import { useEffect, useState, type ReactNode } from "react"
import { LanguageDescription } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import type { Extension } from "@codemirror/state"
import { Markdown } from "@copilotkit/react-ui"
import CodeMirror from "@uiw/react-codemirror"
import { BookOpen, Check, Code, CodeFile, Copy, Expand, Globe, X } from "reicon-react"
import { MarkdownLink } from "@/components/markdown-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { editorChrome, useEditorTheme } from "@/lib/editor-themes"
import { isPreviewable, openPreview } from "@/lib/preview"
import { useProjectFile } from "@/lib/queries"

interface FileViewerProps {
  projectId: string
  path: string | null
  onClose?: () => void
  onExpand?: () => void
}

export function FileViewer({ projectId, path, onClose, onExpand }: FileViewerProps) {
  const file = useProjectFile(projectId, path)
  const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([])
  const [copied, setCopied] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const editorTheme = useEditorTheme()
  const isMarkdown = /\.(md|markdown)$/i.test(path ?? "")

  // Don't carry the "copied" checkmark over to a different file.
  useEffect(() => {
    setCopied(false)
  }, [path])

  useEffect(() => {
    setLanguageExtensions([])
    if (!path || file.data?.binary) return

    const language = LanguageDescription.matchFilename(languages, path)
    if (!language) return

    let cancelled = false
    void language
      .load()
      .then((support) => {
        if (!cancelled) setLanguageExtensions([support])
      })
      .catch(() => {
        if (!cancelled) setLanguageExtensions([])
      })

    return () => {
      cancelled = true
    }
  }, [path, file.data?.binary])

  if (!path) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a file to preview it.
      </div>
    )
  }

  const content = file.data

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <CodeFile className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={content?.path ?? path}>
          {content?.path ?? path}
        </span>
        {content?.truncated && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            Truncated
          </Badge>
        )}
        {isMarkdown && !content?.binary && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={showSource ? "View rendered markdown" : "View markdown source"}
            title={showSource ? "View rendered" : "View source"}
            onClick={() => setShowSource((value) => !value)}
          >
            {showSource ? <BookOpen className="size-3" /> : <Code className="size-3" />}
          </Button>
        )}
        {isPreviewable(path) && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open in prototype preview"
            title="Open in prototype preview"
            onClick={() => openPreview(projectId, content?.path ?? path)}
          >
            <Globe className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy file path"
          title="Copy file path"
          onClick={() => void copyPath(content?.path ?? path)}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
        {onExpand && (
          <Button variant="ghost" size="icon-xs" aria-label="Expand file viewer" title="Expand" onClick={onExpand}>
            <Expand className="size-3" />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon-xs" aria-label="Close file viewer" title="Close" onClick={onClose}>
            <X className="size-3" />
          </Button>
        )}
      </div>

      {file.isLoading ? (
        <ViewerStatus>Loading file…</ViewerStatus>
      ) : file.isError ? (
        <ViewerStatus>Unable to load file</ViewerStatus>
      ) : content?.binary ? (
        <ViewerStatus>Binary file not shown</ViewerStatus>
      ) : isMarkdown && !showSource ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mrr-doc mrr-markdown mx-auto w-full max-w-3xl px-6 py-5">
            <Markdown content={content?.content ?? ""} components={{ a: MarkdownLink }} />
          </div>
        </ScrollArea>
      ) : (
        <CodeMirror
          key={content?.path ?? path}
          value={content?.content ?? ""}
          height="100%"
          className="h-full min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
          basicSetup={{ lineNumbers: true }}
          readOnly
          editable={false}
          theme={editorTheme}
          extensions={[...languageExtensions, editorChrome]}
        />
      )}
    </div>
  )

  async function copyPath(filePath: string) {
    try {
      await navigator.clipboard.writeText(filePath)
    } catch {
      return
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
}

function ViewerStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
