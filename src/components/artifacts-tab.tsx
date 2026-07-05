import { useCallback, useEffect, useRef, useState } from "react"
import type { ArtifactInfo, ArtifactKind } from "@shared/types"
import { Markdown } from "@copilotkit/react-ui"
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Hammer,
  Home,
  LayoutGrid,
  MessagesSquare,
  PenTool,
  RotateCw,
  Terminal,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MarkdownLink } from "@/components/markdown-link"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { designPreviewUrl, openDesignExternal } from "@/lib/preview"
import { relativeTime } from "@/lib/format"
import { useArtifactContent, useDeleteArtifact, useProjectArtifacts, useThreads } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface ArtifactsTabProps {
  projectId: string
  /** Prototype slug open in the embedded browser (null = gallery). */
  openSlug: string | null
  onOpenSlug: (slug: string | null) => void
  onSelectThread?: (threadId: string) => void
  onStartBuildThread?: (promptText: string) => void
}

export function ArtifactsTab({ projectId, openSlug, onOpenSlug, onSelectThread, onStartBuildThread }: ArtifactsTabProps) {
  const artifacts = useProjectArtifacts(projectId)
  const [openDoc, setOpenDoc] = useState<ArtifactInfo | null>(null)
  const openPrototype = artifacts.data?.find((a) => a.kind === "prototype" && a.slug === openSlug) ?? null

  // If the open artifact disappeared (deleted here or externally), fall back
  // to the gallery instead of pointing the viewer at a 404.
  useEffect(() => {
    if (openSlug && artifacts.data && !artifacts.data.some((a) => a.kind === "prototype" && a.slug === openSlug))
      onOpenSlug(null)
  }, [openSlug, artifacts.data, onOpenSlug])
  useEffect(() => {
    if (openDoc && artifacts.data && !artifacts.data.some((a) => a.id === openDoc.id)) setOpenDoc(null)
  }, [openDoc, artifacts.data])

  if (openPrototype) {
    return (
      <PrototypeBrowser
        key={`${projectId}:${openPrototype.slug}`}
        projectId={projectId}
        artifact={openPrototype}
        onBackToGallery={() => onOpenSlug(null)}
      />
    )
  }

  if (openDoc) {
    return (
      <DocumentViewer
        key={openDoc.id}
        projectId={projectId}
        artifact={openDoc}
        onBackToGallery={() => setOpenDoc(null)}
        onStartBuildThread={onStartBuildThread}
      />
    )
  }

  return (
    <ArtifactGallery
      projectId={projectId}
      artifacts={artifacts.data ?? []}
      loading={artifacts.isLoading}
      onOpenPrototype={(slug) => onOpenSlug(slug)}
      onOpenDoc={setOpenDoc}
      onSelectThread={onSelectThread}
    />
  )
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

const KIND_SECTIONS: Array<{ kind: ArtifactKind; label: string }> = [
  { kind: "prototype", label: "Prototypes" },
  { kind: "spec", label: "Specs" },
  { kind: "prompt", label: "Build prompts" },
]

function ArtifactGallery({
  projectId,
  artifacts,
  loading,
  onOpenPrototype,
  onOpenDoc,
  onSelectThread,
}: {
  projectId: string
  artifacts: ArtifactInfo[]
  loading: boolean
  onOpenPrototype: (slug: string) => void
  onOpenDoc: (artifact: ArtifactInfo) => void
  onSelectThread?: (threadId: string) => void
}) {
  const threads = useThreads(projectId, true)
  const threadTitle = (threadId: string | null) =>
    threadId ? (threads.data?.find((t) => t.id === threadId)?.title ?? null) : null

  if (!loading && artifacts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border bg-muted/40">
          <PenTool className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">No artifacts yet</p>
          <p className="max-w-72 text-sm text-muted-foreground">
            Start a <span className="font-medium text-foreground">Product Design</span> session and its specs,
            prototypes, and build prompts will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full @container">
      <div className="space-y-6 p-4">
        {KIND_SECTIONS.map(({ kind, label }) => {
          const items = artifacts.filter((a) => a.kind === kind)
          if (items.length === 0) return null
          return (
            <section key={kind} className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
              <div className="grid grid-cols-1 gap-4 @[480px]:grid-cols-2 @[900px]:grid-cols-3">
                {items.map((artifact) =>
                  artifact.kind === "prototype" ? (
                    <PrototypeCard
                      key={artifact.id}
                      projectId={projectId}
                      artifact={artifact}
                      threadTitle={threadTitle(artifact.threadId)}
                      onOpen={() => onOpenPrototype(artifact.slug)}
                      onSelectThread={onSelectThread}
                    />
                  ) : (
                    <DocumentCard
                      key={artifact.id}
                      artifact={artifact}
                      threadTitle={threadTitle(artifact.threadId)}
                      onOpen={() => onOpenDoc(artifact)}
                      onSelectThread={onSelectThread}
                    />
                  ),
                )}
              </div>
            </section>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function ThreadChip({
  threadId,
  threadTitle,
  onSelectThread,
}: {
  threadId: string | null
  threadTitle: string | null
  onSelectThread?: (threadId: string) => void
}) {
  if (!threadId || !threadTitle) return null
  return (
    <button
      type="button"
      onClick={() => onSelectThread?.(threadId)}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground",
        onSelectThread && "cursor-pointer transition-colors hover:bg-accent hover:text-foreground",
      )}
      title={onSelectThread ? `Open thread: ${threadTitle}` : threadTitle}
    >
      <MessagesSquare className="size-3 shrink-0" />
      <span className="truncate">{threadTitle}</span>
    </button>
  )
}

function PrototypeCard({
  projectId,
  artifact,
  threadTitle,
  onOpen,
  onSelectThread,
}: {
  projectId: string
  artifact: ArtifactInfo
  threadTitle: string | null
  onOpen: () => void
  onSelectThread?: (threadId: string) => void
}) {
  return (
    <div className="group overflow-hidden rounded-xl border bg-card text-left shadow-xs transition-colors hover:border-ring/40">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left" aria-label={`Open ${artifact.title}`}>
        <PrototypeThumbnail projectId={projectId} slug={artifact.slug} version={artifact.updatedAt} />
      </button>
      <div className="space-y-1.5 border-t px-3.5 py-3">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full cursor-pointer truncate text-left text-sm font-medium hover:underline"
        >
          {artifact.title}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-mono">{artifact.slug}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{relativeTime(artifact.updatedAt)}</span>
        </div>
        <ThreadChip threadId={artifact.threadId} threadTitle={threadTitle} onSelectThread={onSelectThread} />
      </div>
    </div>
  )
}

function DocumentCard({
  artifact,
  threadTitle,
  onOpen,
  onSelectThread,
}: {
  artifact: ArtifactInfo
  threadTitle: string | null
  onOpen: () => void
  onSelectThread?: (threadId: string) => void
}) {
  const Icon = artifact.kind === "spec" ? FileText : Terminal
  return (
    <div className="group overflow-hidden rounded-xl border bg-card text-left shadow-xs transition-colors hover:border-ring/40">
      <div className="space-y-1.5 px-3.5 py-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full cursor-pointer items-center gap-2 text-left text-sm font-medium hover:underline"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{artifact.title}</span>
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-mono">{artifact.slug}.md</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{relativeTime(artifact.updatedAt)}</span>
        </div>
        <ThreadChip threadId={artifact.threadId} threadTitle={threadTitle} onSelectThread={onSelectThread} />
      </div>
    </div>
  )
}

/**
 * Live miniature of the prototype's entry page: the real index.html rendered
 * in a scaled-down, inert iframe (scripts are blocked server-side by CSP, and
 * the sandbox grants nothing but same-origin rendering).
 */
function PrototypeThumbnail({ projectId, slug, version }: { projectId: string; slug: string; version: string }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden border-b bg-white">
      <iframe
        // Re-mount on update so a revised prototype shows its fresh entry page.
        key={version}
        src={designPreviewUrl(projectId, slug)}
        title={`${slug} preview`}
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        sandbox="allow-same-origin"
        scrolling="no"
        className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-25 select-none border-0"
      />
      <div className="absolute inset-0" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spec / prompt viewer
// ---------------------------------------------------------------------------

function DocumentViewer({
  projectId,
  artifact,
  onBackToGallery,
  onStartBuildThread,
}: {
  projectId: string
  artifact: ArtifactInfo
  onBackToGallery: () => void
  onStartBuildThread?: (promptText: string) => void
}) {
  const content = useArtifactContent(projectId, artifact.kind, artifact.slug)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteArtifact = useDeleteArtifact(projectId)
  const text = content.data?.content ?? ""

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard")
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onBackToGallery} aria-label="All artifacts">
              <LayoutGrid className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>All artifacts</TooltipContent>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border" />
        <div className="mx-1 flex min-w-0 flex-1 items-center rounded-md border bg-muted/40 px-2.5 py-1">
          <span className="truncate font-mono text-xs text-muted-foreground" title={`${artifact.slug}.md`}>
            <span className="capitalize text-foreground/70">{artifact.kind}</span> / {artifact.slug}.md
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={copy} disabled={!text} aria-label="Copy content">
              <Copy className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy content</TooltipContent>
        </Tooltip>
        {artifact.kind === "prompt" && onStartBuildThread && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onStartBuildThread(text)}
                disabled={!text}
                aria-label="Start build thread"
              >
                <Hammer className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Start build thread with this prompt</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete artifact"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete artifact</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mrr-doc mrr-markdown mx-auto w-full max-w-3xl p-6">
          {content.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Markdown content={text} components={{ a: MarkdownLink }} />
          )}
        </div>
      </ScrollArea>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{artifact.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {artifact.kind === "spec" ? "spec" : "build prompt"}. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteArtifact.mutate({ kind: artifact.kind, slug: artifact.slug }, { onSuccess: onBackToGallery })
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Embedded prototype browser
// ---------------------------------------------------------------------------

function PrototypeBrowser({
  projectId,
  artifact,
  onBackToGallery,
}: {
  projectId: string
  artifact: ArtifactInfo
  onBackToGallery: () => void
}) {
  const entryUrl = designPreviewUrl(projectId, artifact.slug)
  const previewPrefix = entryUrl // ".../preview/" — page paths are relative to it
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Own navigation history over the iframe. Programmatic moves use
  // location.replace so they don't also pollute the app window's history.
  const stackRef = useRef<string[]>([entryUrl])
  const indexRef = useRef(0)
  const navigatingRef = useRef(false)
  const [currentPage, setCurrentPage] = useState("index.html")
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteArtifact = useDeleteArtifact(projectId)

  const syncNavState = useCallback(() => {
    setCanBack(indexRef.current > 0)
    setCanForward(indexRef.current < stackRef.current.length - 1)
  }, [])

  const pageLabel = useCallback(
    (url: string) => {
      const path = url.startsWith(previewPrefix) ? url.slice(previewPrefix.length) : url
      const clean = path.split("?")[0].split("#")[0]
      return clean === "" || clean === "/" ? "index.html" : decodeURIComponent(clean)
    },
    [previewPrefix],
  )

  const handleLoad = useCallback(() => {
    const loc = iframeRef.current?.contentWindow?.location
    if (!loc || loc.href === "about:blank") return
    const url = loc.pathname + loc.search + loc.hash
    if (navigatingRef.current) {
      // A back/forward/home move landing — don't push a new entry.
      navigatingRef.current = false
    } else if (url !== stackRef.current[indexRef.current]) {
      stackRef.current = [...stackRef.current.slice(0, indexRef.current + 1), url]
      indexRef.current = stackRef.current.length - 1
    }
    setCurrentPage(pageLabel(url))
    syncNavState()
  }, [pageLabel, syncNavState])

  const navigateTo = useCallback((url: string) => {
    navigatingRef.current = true
    iframeRef.current?.contentWindow?.location.replace(url)
  }, [])

  const goBack = () => {
    if (indexRef.current === 0) return
    indexRef.current -= 1
    navigateTo(stackRef.current[indexRef.current])
    syncNavState()
  }
  const goForward = () => {
    if (indexRef.current >= stackRef.current.length - 1) return
    indexRef.current += 1
    navigateTo(stackRef.current[indexRef.current])
    syncNavState()
  }
  const goHome = () => {
    const current = stackRef.current[indexRef.current]
    if (current === entryUrl) return
    stackRef.current = [...stackRef.current.slice(0, indexRef.current + 1), entryUrl]
    indexRef.current = stackRef.current.length - 1
    navigateTo(entryUrl)
    syncNavState()
  }
  const reload = () => {
    navigatingRef.current = true
    iframeRef.current?.contentWindow?.location.reload()
  }
  const popOut = () => {
    openDesignExternal(stackRef.current[indexRef.current])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onBackToGallery} aria-label="All artifacts">
              <LayoutGrid className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>All artifacts</TooltipContent>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon-sm" onClick={goBack} disabled={!canBack} aria-label="Back">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={goForward} disabled={!canForward} aria-label="Forward">
          <ChevronRight className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={reload} aria-label="Reload">
          <RotateCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={goHome} aria-label="Home">
          <Home className="size-4" />
        </Button>
        <div className="mx-1 flex min-w-0 flex-1 items-center rounded-md border bg-muted/40 px-2.5 py-1">
          <span className="truncate font-mono text-xs text-muted-foreground" title={`${artifact.slug} / ${currentPage}`}>
            <span className="text-foreground/70">{artifact.slug}</span> / {currentPage}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={popOut} aria-label="Open in window">
              <ExternalLink className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in window</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete prototype"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete prototype</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        <iframe
          ref={iframeRef}
          src={entryUrl}
          onLoad={handleLoad}
          title={artifact.title}
          sandbox="allow-same-origin"
          className="h-full w-full border-0"
        />
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{artifact.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prototype and all of its pages. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteArtifact.mutate({ kind: "prototype", slug: artifact.slug }, { onSuccess: onBackToGallery })
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
