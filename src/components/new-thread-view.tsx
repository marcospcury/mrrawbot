import { useLayoutEffect, useRef, useState } from "react"
import { BrowserCode, PenNib } from "reicon-react"
import { ArrowUp } from "lucide-react"
import type { FlowConfig, ProductDesignPersona, Thread, ThreadKind } from "@shared/types"
import {
  ArtifactChips,
  ArtifactsPickerPill,
  AttachFilesButton,
  AttachedFileChips,
  ComposerRunControls,
  errorMessage,
  formatAttachedFiles,
  uploadStagedFiles,
  useComposerAttachments,
} from "@/components/composer"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useRunConfig, type RunConfig } from "@/hooks/use-run-config"
import { api } from "@/lib/api"
import { useProjectArtifacts } from "@/lib/queries"
import { cn } from "@/lib/utils"

const MODES: Array<{
  kind: ThreadKind
  icon: typeof BrowserCode
  title: string
  description: string
}> = [
  {
    kind: "build",
    icon: BrowserCode,
    title: "Build",
    description: "Code, fix, and ship changes with agents or flows",
  },
  {
    kind: "product-design",
    icon: PenNib,
    title: "Product design",
    description: "Discover and design with the Specialist and Designer",
  },
]

/**
 * The "no thread open" landing view with the full composer. Nothing persists
 * until the first message is sent: files stage locally and upload at send
 * time, artifact selection lives in local state, and the thread is created
 * (then attached and launched) only on send. If preparing the thread fails
 * after creation, it is discarded so no empty threads are left behind.
 */
export function NewThreadView({
  projectId,
  projectName,
  flows,
  onManageFlows,
  persona,
  onPersonaChange,
  onCreateThread,
  onLaunch,
  onDiscard,
}: {
  projectId: string
  projectName: string
  flows: FlowConfig[]
  onManageFlows: () => void
  persona: ProductDesignPersona
  onPersonaChange: (persona: ProductDesignPersona) => void
  onCreateThread: (kind: ThreadKind, config: RunConfig) => Promise<Thread>
  onLaunch: (thread: Thread, firstMessage: string) => void
  onDiscard: (thread: Thread) => Promise<void>
}) {
  const [kind, setKind] = useState<ThreadKind>("build")
  const [text, setText] = useState("")
  const [isComposing, setIsComposing] = useState(false)
  const [starting, setStarting] = useState(false)
  // Draft run config for the thread-to-be; applied at creation time.
  const [draft, setDraft] = useState<RunConfig>({ flowId: null, session: null })
  const run = useRunConfig({ flows, flowId: draft.flowId, session: draft.session, onChangeRun: setDraft })
  const attachments = useComposerAttachments(starting)
  // Draft artifact selection, attached to the thread at creation time.
  const [artifactIds, setArtifactIds] = useState<Set<string>>(new Set())
  const projectArtifacts = useProjectArtifacts(projectId)
  const selectedArtifacts = (projectArtifacts.data ?? []).filter((a) => artifactIds.has(a.id))
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isProductDesign = kind === "product-design"
  const canSend = !starting && !attachments.isUploading && text.trim().length > 0

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  function toggleArtifact(id: string) {
    setArtifactIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function send() {
    const message = text.trim()
    if (!message || starting || attachments.isUploading) return
    setStarting(true)
    attachments.setErrors([])
    try {
      const thread = await onCreateThread(kind, draft)
      try {
        let finalMessage = message
        if (attachments.stagedFiles.length > 0) {
          const uploaded = await uploadStagedFiles(thread.id, attachments.stagedFiles)
          finalMessage = `${message}\n\n${formatAttachedFiles(uploaded)}`
        }
        if (!isProductDesign && artifactIds.size > 0) {
          await api.setThreadArtifacts(thread.id, [...artifactIds])
        }
        onLaunch(thread, finalMessage)
      } catch (err) {
        // Don't leave an empty thread behind when preparing it failed.
        await onDiscard(thread).catch(() => {})
        throw err
      }
    } catch (err) {
      attachments.setErrors([errorMessage(err)])
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="mrr-header flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="text-muted-foreground" />
      </header>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="animate-mrr-in flex w-full max-w-3xl flex-col items-center">
          <h1 className="text-xl font-semibold tracking-tight">
            What are we doing in <span className="text-primary">{projectName}</span>?
          </h1>

          <div className="mt-8 grid w-full max-w-xl grid-cols-2 gap-2">
            {MODES.map((mode) => (
              <button
                key={mode.kind}
                type="button"
                aria-pressed={kind === mode.kind}
                onClick={() => {
                  setKind(mode.kind)
                  textareaRef.current?.focus()
                }}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors",
                  kind === mode.kind
                    ? "border-primary/60 bg-primary/5"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <mode.icon className="size-4" />
                  {mode.title}
                </span>
                <span className="text-xs text-muted-foreground">{mode.description}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex w-full flex-col gap-2 rounded-2xl border bg-card p-2.5 shadow-[0_10px_30px_color-mix(in_oklch,var(--foreground)_8%,transparent)] [view-transition-name:mrr-composer]">
            {!isProductDesign && (
              <ArtifactChips artifacts={selectedArtifacts} onDetach={toggleArtifact} />
            )}
            <AttachedFileChips
              files={attachments.stagedFiles}
              errors={attachments.errors}
              onRemove={attachments.removeStagedFile}
              isDisabled={attachments.isDisabled}
            />
            <textarea
              ref={textareaRef}
              autoFocus
              rows={1}
              // Keep password managers from offering autofill on the prompt field.
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              value={text}
              placeholder={isProductDesign ? "Describe the product or feature…" : "Describe a task…"}
              className="max-h-44 w-full resize-none bg-transparent px-1 py-2 text-sm leading-normal outline-none"
              onChange={(e) => setText(e.target.value)}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
              <ComposerRunControls
                run={run}
                flows={flows}
                onManageFlows={onManageFlows}
                isProductDesign={isProductDesign}
                persona={persona}
                onPersonaChange={onPersonaChange}
                afterModeToggle={
                  <>
                    <AttachFilesButton attachments={attachments} />
                    {!isProductDesign && (
                      <ArtifactsPickerPill
                        projectId={projectId}
                        folderId={null}
                        attachedIds={artifactIds}
                        onToggle={(artifact) => toggleArtifact(artifact.id)}
                      />
                    )}
                  </>
                }
              />
              <button
                type="button"
                disabled={!canSend}
                aria-label="Start thread"
                onClick={() => void send()}
                className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full border bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
