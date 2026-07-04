import { useCallback, useEffect, useRef, useState } from "react"
import type { DesignInfo } from "@shared/types"
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Home,
  LayoutGrid,
  MessagesSquare,
  PenTool,
  RotateCw,
  Trash2,
} from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { designPreviewUrl, openDesignExternal } from "@/lib/preview"
import { relativeTime } from "@/lib/format"
import { useDeleteDesign, useProjectDesigns, useThreads } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface DesignTabProps {
  projectId: string
  openSlug: string | null
  onOpenSlug: (slug: string | null) => void
  onSelectThread?: (threadId: string) => void
}

export function DesignTab({ projectId, openSlug, onOpenSlug, onSelectThread }: DesignTabProps) {
  const designs = useProjectDesigns(projectId)
  const open = designs.data?.find((d) => d.slug === openSlug) ?? null

  // If the open design disappeared (deleted here or externally), fall back to
  // the gallery instead of pointing the browser at a 404.
  useEffect(() => {
    if (openSlug && designs.data && !designs.data.some((d) => d.slug === openSlug)) onOpenSlug(null)
  }, [openSlug, designs.data, onOpenSlug])

  if (open) {
    return (
      <DesignBrowser
        key={`${projectId}:${open.slug}`}
        projectId={projectId}
        design={open}
        onBackToGallery={() => onOpenSlug(null)}
      />
    )
  }

  return (
    <DesignGallery
      projectId={projectId}
      designs={designs.data ?? []}
      loading={designs.isLoading}
      onOpen={(slug) => onOpenSlug(slug)}
      onSelectThread={onSelectThread}
    />
  )
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function DesignGallery({
  projectId,
  designs,
  loading,
  onOpen,
  onSelectThread,
}: {
  projectId: string
  designs: DesignInfo[]
  loading: boolean
  onOpen: (slug: string) => void
  onSelectThread?: (threadId: string) => void
}) {
  const threads = useThreads(projectId, true)
  const threadTitle = (threadId: string | null) =>
    threadId ? (threads.data?.find((t) => t.id === threadId)?.title ?? null) : null

  if (!loading && designs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border bg-muted/40">
          <PenTool className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">No designs yet</p>
          <p className="max-w-64 text-sm text-muted-foreground">
            Run a thread with the <span className="font-medium text-foreground">Product/UI Designer</span> role and its
            prototypes will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full @container">
      <div className="grid grid-cols-1 gap-4 p-4 @[480px]:grid-cols-2 @[900px]:grid-cols-3">
        {designs.map((design) => (
          <DesignCard
            key={design.id}
            projectId={projectId}
            design={design}
            threadTitle={threadTitle(design.threadId)}
            onOpen={() => onOpen(design.slug)}
            onSelectThread={onSelectThread}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function DesignCard({
  projectId,
  design,
  threadTitle,
  onOpen,
  onSelectThread,
}: {
  projectId: string
  design: DesignInfo
  threadTitle: string | null
  onOpen: () => void
  onSelectThread?: (threadId: string) => void
}) {
  return (
    <div className="group overflow-hidden rounded-xl border bg-card text-left shadow-xs transition-colors hover:border-ring/40">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left" aria-label={`Open ${design.title}`}>
        <DesignThumbnail projectId={projectId} slug={design.slug} version={design.updatedAt} />
      </button>
      <div className="space-y-1.5 border-t px-3.5 py-3">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full cursor-pointer truncate text-left text-sm font-medium hover:underline"
        >
          {design.title}
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-mono">{design.slug}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{relativeTime(design.updatedAt)}</span>
        </div>
        {design.threadId && threadTitle && (
          <button
            type="button"
            onClick={() => onSelectThread?.(design.threadId!)}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground",
              onSelectThread && "cursor-pointer transition-colors hover:bg-accent hover:text-foreground",
            )}
            title={onSelectThread ? `Open thread: ${threadTitle}` : threadTitle}
          >
            <MessagesSquare className="size-3 shrink-0" />
            <span className="truncate">{threadTitle}</span>
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Live miniature of the prototype's entry page: the real index.html rendered
 * in a scaled-down, inert iframe (scripts are blocked server-side by CSP, and
 * the sandbox grants nothing but same-origin rendering).
 */
function DesignThumbnail({ projectId, slug, version }: { projectId: string; slug: string; version: string }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden border-b bg-white">
      <iframe
        // Re-mount on update so a revised design shows its fresh entry page.
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
// Embedded browser
// ---------------------------------------------------------------------------

function DesignBrowser({
  projectId,
  design,
  onBackToGallery,
}: {
  projectId: string
  design: DesignInfo
  onBackToGallery: () => void
}) {
  const entryUrl = designPreviewUrl(projectId, design.slug)
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
  const deleteDesign = useDeleteDesign(projectId)

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
            <Button variant="ghost" size="icon-sm" onClick={onBackToGallery} aria-label="All designs">
              <LayoutGrid className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>All designs</TooltipContent>
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
          <span className="truncate font-mono text-xs text-muted-foreground" title={`${design.slug} / ${currentPage}`}>
            <span className="text-foreground/70">{design.slug}</span> / {currentPage}
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
              aria-label="Delete design"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete design</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        <iframe
          ref={iframeRef}
          src={entryUrl}
          onLoad={handleLoad}
          title={design.title}
          sandbox="allow-same-origin"
          className="h-full w-full border-0"
        />
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{design.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the prototype and all of its pages. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteDesign.mutate(design.slug, { onSuccess: onBackToGallery })
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
