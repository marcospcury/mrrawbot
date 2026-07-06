import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { Check, ChevronDown, FileText, Flash2, Hierarchy2, Paperclip, PenNib, Settings2, TerminalSquare, Users, X } from "reicon-react"
import { Bot, Brain } from "lucide-react"
import { useChatContext } from "@copilotkit/react-ui"
import {
  BUILD_ROLES,
  effortLabel,
  effortsFor,
  roleName,
  type ArtifactInfo,
  type Effort,
  type FlowConfig,
  type ProductDesignPersona,
  type SessionConfig,
  type Thread,
} from "@shared/types"
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type PromptAttachmentUploadResponse,
  type PromptAttachmentKind,
  inferPromptAttachmentKind,
} from "@shared/attachments"
import { scopeArtifacts } from "@shared/artifact-scope"
import { ModelCombobox } from "@/components/model-combobox"
import { ProviderPill } from "@/components/provider-pill"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useRunConfig, type RunConfig } from "@/hooks/use-run-config"
import { api } from "@/lib/api"
import { providerMeta } from "@/lib/format"
import { useProjectArtifacts, useSetThreadArtifacts, useThreadArtifacts, useThreads } from "@/lib/queries"
import { cn } from "@/lib/utils"

export type StagedFile = {
  id: string
  file: File
  name: string
  size: number
  kind: PromptAttachmentKind
  status?: "ready" | "error"
  error?: string
}

/**
 * Local attachment staging shared by the in-thread composer and the
 * new-thread landing view. Files are only staged here — uploading happens at
 * send time, once a thread id exists.
 */
export function useComposerAttachments(disabled: boolean) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isDisabled = disabled || isUploading

  async function onAttachFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ""
    if (files.length === 0 || isDisabled) return

    setIsUploading(true)
    const accepted: StagedFile[] = []
    const nextErrors: string[] = []
    let nextCount = stagedFiles.length

    try {
      for (const file of files) {
        const reason = await validateAttachment(file, nextCount)
        if (reason) {
          nextErrors.push(reason)
          continue
        }
        const staged = buildStagedFile(file)
        if (!staged.ok) {
          nextErrors.push(staged.error)
          continue
        }
        accepted.push(staged.value)
        nextCount += 1
      }
    } finally {
      setErrors(nextErrors)
      if (accepted.length > 0) setStagedFiles((next) => [...next, ...accepted])
      setIsUploading(false)
    }
  }

  function removeStagedFile(id: string) {
    setStagedFiles((next) => next.filter((file) => file.id !== id))
  }

  function openPicker() {
    if (isDisabled) return
    fileInputRef.current?.click()
  }

  return {
    stagedFiles,
    setStagedFiles,
    errors,
    setErrors,
    isUploading,
    setIsUploading,
    isDisabled,
    fileInputRef,
    onAttachFiles,
    removeStagedFile,
    openPicker,
  }
}

export function Composer({
  thread,
  flows,
  flowId,
  session,
  onChangeRun,
  onManageFlows,
  persona,
  onPersonaChange,
  prefill,
  onPrefillConsumed,
  initialMessage,
  onInitialMessageConsumed,
  inProgress,
  onSend,
  onStop,
  chatReady = true,
}: {
  thread: Thread
  flows: FlowConfig[]
  flowId: string | null
  session: SessionConfig | null
  onChangeRun: (next: RunConfig) => void
  onManageFlows: () => void
  persona: ProductDesignPersona
  onPersonaChange: (persona: ProductDesignPersona) => void
  prefill: string | null
  onPrefillConsumed: () => void
  initialMessage?: string | null
  onInitialMessageConsumed?: () => void
  inProgress: boolean
  onSend: (message: string) => void | Promise<unknown>
  onStop?: () => void
  chatReady?: boolean
}) {
  const isProductDesign = thread.kind === "product-design"
  const [text, setText] = useState("")
  const [isComposing, setIsComposing] = useState(false)
  const attachments = useComposerAttachments(inProgress)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const chatContext = useChatContext()
  const run = useRunConfig({ flows, flowId, session, onChangeRun })
  const canSend = chatReady && !inProgress && !attachments.isUploading && text.trim().length > 0
  const canStop = inProgress
  const sendDisabled = !canSend && !canStop
  const buttonIcon = !chatReady
    ? chatContext.icons.spinnerIcon
    : inProgress
      ? chatContext.icons.stopIcon
      : chatContext.icons.sendIcon
  const buttonAlt = !chatReady ? "Loading" : inProgress ? "Stop" : "Send"

  // Layout effect: size the textarea before paint so growing/shrinking while
  // typing never flashes an intermediate height.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  // "Start build thread" prefill from a prompt artifact — fill, don't send.
  useEffect(() => {
    if (prefill == null) return
    setText(prefill)
    onPrefillConsumed()
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [prefill, onPrefillConsumed])

  // First message of a thread started from the new-thread view: send it as
  // soon as the chat connects. The ref guards StrictMode's double effects.
  const initialSentRef = useRef(false)
  useEffect(() => {
    if (initialMessage == null || !chatReady || inProgress || initialSentRef.current) return
    initialSentRef.current = true
    onInitialMessageConsumed?.()
    void onSend(initialMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, chatReady, inProgress])

  async function send() {
    const message = text.trim()
    if (!message || inProgress || attachments.isUploading) return

    if (attachments.stagedFiles.length === 0) {
      // Clear optimistically — onSend resolves only after the request lands,
      // which is too late for the composer to feel responsive.
      attachments.setErrors([])
      setText("")
      requestAnimationFrame(() => textareaRef.current?.focus())
      try {
        await onSend(message)
      } catch (err) {
        setText(message)
        attachments.setErrors([errorMessage(err)])
      }
      return
    }

    attachments.setErrors([])
    attachments.setIsUploading(true)
    try {
      const uploaded = await uploadStagedFiles(thread.id, attachments.stagedFiles)
      const finalMessage = `${message}\n\n${formatAttachedFiles(uploaded)}`
      // Uploads done — clear before the send request so the composer resets
      // the moment the message leaves.
      setText("")
      attachments.setStagedFiles([])
      requestAnimationFrame(() => textareaRef.current?.focus())
      try {
        await onSend(finalMessage)
      } catch (err) {
        setText(message)
        attachments.setErrors([errorMessage(err)])
      }
    } catch (err) {
      attachments.setErrors([errorMessage(err)])
    } finally {
      attachments.setIsUploading(false)
    }
  }

  return (
    <div className="copilotKitInputContainer">
      <div className="mrr-composer">
        {!isProductDesign && <AttachedArtifactChips thread={thread} />}
        <AttachedFileChips
          files={attachments.stagedFiles}
          errors={attachments.errors}
          onRemove={attachments.removeStagedFile}
          isDisabled={attachments.isDisabled}
        />
        <div className="mrr-composer-main">
          <textarea
            ref={textareaRef}
            data-testid="copilot-chat-textarea"
            rows={1}
            // Keep password managers from offering autofill on the prompt field.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            value={text}
            placeholder={isProductDesign ? "Describe the product or feature…" : "Describe a task…"}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                e.preventDefault()
                if (canSend) send()
              }
            }}
          />
        </div>

        <div className="mrr-composer-controls">
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
                {!isProductDesign && <AttachArtifactsPill thread={thread} />}
              </>
            }
          />
          <div className="copilotKitInputControls mrr-composer-send">
            <button
              type="button"
              disabled={sendDisabled}
              onClick={() => (inProgress ? onStop?.() : send())}
              data-copilotkit-in-progress={inProgress}
              data-testid="copilot-send-button"
              data-test-id={inProgress ? "copilot-chat-request-in-progress" : "copilot-chat-ready"}
              className="copilotKitInputControlButton"
              aria-label={buttonAlt}
            >
              {buttonIcon}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The run-config pill cluster: single/flow toggle, then either the flow picker
 * or model + effort + fast + role/persona. Shared between the in-thread
 * composer and the new-thread landing view.
 */
export function ComposerRunControls({
  run,
  flows,
  onManageFlows,
  isProductDesign,
  persona,
  onPersonaChange,
  afterModeToggle,
}: {
  run: ReturnType<typeof useRunConfig>
  flows: FlowConfig[]
  onManageFlows: () => void
  isProductDesign: boolean
  persona: ProductDesignPersona
  onPersonaChange: (persona: ProductDesignPersona) => void
  afterModeToggle?: ReactNode
}) {
  function selectFlowMode() {
    if (run.flow) return
    const firstFlow = flows[0]
    if (firstFlow) run.selectFlow(firstFlow.id)
    else onManageFlows()
  }

  return (
    <>
      {!isProductDesign && (
        <ModeToggle flowActive={!!run.flow} onSingle={run.selectSingle} onFlow={selectFlowMode} />
      )}
      {afterModeToggle}
      {!isProductDesign && run.flow ? (
        <>
          <FlowPicker run={run} flows={flows} onManageFlows={onManageFlows} />
          <FlowProviderSummary providers={run.flowProviders} unavailable={run.unavailableFlowProviders} />
        </>
      ) : (
        <>
          <ModelCombobox
            compact
            value={run.selectedModel}
            provider={run.active.provider}
            catalog={run.catalog}
            align="start"
            onSelect={({ model, provider }) => run.setModel(model, provider)}
          />
          <EffortPill session={run.active} onEffort={run.setEffort} />
          {run.active.provider === "codex" && run.fastModels.includes(run.selectedModel) && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-pressed={run.active.fast}
              onClick={() => run.setFast(!run.active.fast)}
              className={cn(
                "rounded-full text-[11px]",
                run.active.fast && "border-amber-400/50 bg-amber-400/10 text-amber-400 hover:text-amber-400",
              )}
              title="Fast service tier"
            >
              <Flash2 className="size-3" />
              <span className="mrr-pill-label">Fast</span>
            </Button>
          )}
          {isProductDesign ? (
            <PersonaPill persona={persona} onPersona={onPersonaChange} />
          ) : (
            <RolePill role={run.active.role} onRole={run.setRole} />
          )}
        </>
      )}
    </>
  )
}

const attachmentInputAccept = Array.from(
  new Set([
    ...ALLOWED_ATTACHMENT_EXTENSIONS.text,
    ...ALLOWED_ATTACHMENT_EXTENSIONS.data,
    ...ALLOWED_ATTACHMENT_EXTENSIONS.image,
    ...ALLOWED_ATTACHMENT_EXTENSIONS.pdf,
  ]),
)
  .map((ext) => `.${ext}`)
  .join(",")

/** Hidden file input + paperclip pill for a useComposerAttachments instance. */
export function AttachFilesButton({
  attachments,
}: {
  attachments: ReturnType<typeof useComposerAttachments>
}) {
  return (
    <>
      <input
        ref={attachments.fileInputRef}
        type="file"
        multiple
        className="sr-only"
        accept={attachmentInputAccept}
        onChange={attachments.onAttachFiles}
        disabled={attachments.isDisabled}
      />
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="rounded-full text-[11px]"
        disabled={attachments.isDisabled}
        onClick={attachments.openPicker}
        title="Attach files"
        aria-label="Attach files"
      >
        <Paperclip className="size-3" />
      </Button>
    </>
  )
}

function formatAttachmentSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  if (bytes === 0) return "0 B"
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return "Unable to send message with attachments. Please retry."
}

function getFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".")
  if (dotIndex < 0) return ""
  return filename.slice(dotIndex + 1).toLowerCase()
}

export function formatAttachedFiles(attachments: PromptAttachmentUploadResponse[]): string {
  const lines = attachments.map((attachment) => `- ${attachment.absolutePath} (${attachment.kind})`)
  return `# Attached files\n${lines.join("\n")}`
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read "${file.name}".`))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error(`Could not read "${file.name}".`))
    }
    reader.readAsDataURL(file)
  })
}

function fileToBase64DataUrl(file: File): Promise<string> {
  return fileToDataUrl(file).then((dataUrl) => {
    const commaIndex = dataUrl.indexOf(",")
    if (commaIndex < 0) throw new Error(`Cannot add "${file.name}": unable to read file bytes.`)
    return dataUrl.slice(commaIndex + 1)
  })
}

export async function uploadStagedFiles(
  threadId: string,
  files: StagedFile[],
): Promise<PromptAttachmentUploadResponse[]> {
  const uploaded: PromptAttachmentUploadResponse[] = []
  for (const staged of files) {
    const dataBase64 = await fileToBase64DataUrl(staged.file)
    const response = await api.uploadThreadFile(threadId, {
      filename: staged.name,
      mimeType: staged.file.type || null,
      dataBase64: dataBase64,
    }).catch((err) => {
      throw new Error(`Cannot upload "${staged.name}": ${errorMessage(err)}`)
    })
    uploaded.push(response)
  }
  return uploaded
}

async function validateAttachment(file: File, existingCount: number): Promise<string | null> {
  if (existingCount >= MAX_ATTACHMENTS) {
    return `Cannot add "${file.name}": you can attach at most ${MAX_ATTACHMENTS} files.`
  }
  if (file.size === 0) {
    return `Cannot add "${file.name}": file is empty and cannot be uploaded.`
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Cannot add "${file.name}": file exceeds the ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB limit.`
  }
  const kind = inferPromptAttachmentKind(file.name, file.type)
  if (!kind) {
    return `Cannot add "${file.name}": unsupported type "${file.type || getFileExtension(file.name) || "unknown"}".`
  }
  try {
    const preview = await file.slice(0, 1).arrayBuffer()
    if (preview.byteLength === 0) {
      return `Cannot add "${file.name}": unable to read file bytes.`
    }
  } catch {
    return `Cannot add "${file.name}": unable to read file bytes.`
  }
  return null
}

function buildStagedFile(file: File): { ok: true; value: StagedFile } | { ok: false; error: string } {
  const kind = inferPromptAttachmentKind(file.name, file.type)
  if (!kind) return { ok: false, error: `Cannot add "${file.name}": unsupported type "${file.type || getFileExtension(file.name) || "unknown"}".` }

  return {
    ok: true,
    value: {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind,
      status: "ready",
    },
  }
}

export function AttachedFileChips({
  files,
  errors,
  onRemove,
  isDisabled,
}: {
  files: StagedFile[]
  errors: string[]
  onRemove: (id: string) => void
  isDisabled: boolean
}) {
  if (files.length === 0 && errors.length === 0) return null

  return (
    <div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((file) => (
            <span
              key={file.id}
              className="inline-flex h-6 max-w-[18rem] items-center gap-1.5 rounded-full border bg-muted/40 px-2 text-xs text-muted-foreground"
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground/75">({formatAttachmentSize(file.size)})</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-full hover:text-foreground disabled:opacity-50"
                disabled={isDisabled}
                onClick={() => onRemove(file.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-1 space-y-1 text-xs text-destructive">
          {errors.map((error) => (
            <p key={error} className="truncate">
              {error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function ModeToggle({
  flowActive,
  onSingle,
  onFlow,
}: {
  flowActive: boolean
  onSingle: () => void
  onFlow: () => void
}) {
  return (
    <div className="inline-flex shrink-0 rounded-full border bg-background p-0.5 shadow-xs">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Single agent mode"
            aria-pressed={!flowActive}
            onClick={onSingle}
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full transition-colors",
              !flowActive
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Flash2 className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Single agent</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Flow mode"
            aria-pressed={flowActive}
            onClick={onFlow}
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full transition-colors",
              flowActive
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Hierarchy2 className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Flow</TooltipContent>
      </Tooltip>
    </div>
  )
}

function FlowPicker({
  run,
  flows,
  onManageFlows,
}: {
  run: ReturnType<typeof useRunConfig>
  flows: FlowConfig[]
  onManageFlows: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mrr-flow-pill min-w-[13rem] max-w-[24rem] justify-start rounded-full text-[11px]"
        >
          <Hierarchy2 className="size-3" />
          <span className="mrr-pill-label min-w-0 flex-1 truncate text-left">{run.flow?.name ?? "Select flow"}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {flows.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Flows</DropdownMenuLabel>}
        {flows.map((flow) => (
          <DropdownMenuItem key={flow.id} onClick={() => run.selectFlow(flow.id)} className="gap-2">
            <Hierarchy2 className="size-4 text-muted-foreground" />
            <span className="truncate">{flow.name}</span>
            {run.flow?.id === flow.id && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManageFlows} className="gap-2">
          <Settings2 className="size-4" />
          Manage flows…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FlowProviderSummary({
  providers,
  unavailable,
}: {
  providers: ReturnType<typeof useRunConfig>["flowProviders"]
  unavailable: ReturnType<typeof useRunConfig>["unavailableFlowProviders"]
}) {
  const missing = new Set(unavailable)
  return (
    <div className="flex min-w-0 items-center gap-1">
      {providers.slice(0, 5).map((p, i) => (
        <div key={p} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-muted-foreground">→</span>}
          <ProviderPill
            provider={p}
            className={cn(missing.has(p) && "opacity-50 [&>span:first-child]:bg-amber-400")}
          />
        </div>
      ))}
      {unavailable.length > 0 && (
        <span
          className="ml-1 truncate text-[11px] text-amber-500"
          title="This flow uses providers that aren't configured. Set them up in Settings → Providers, or edit the flow to use different providers."
        >
          {unavailable.map((p) => providerMeta(p).short).join(", ")} not set up
        </span>
      )}
    </div>
  )
}

function EffortPill({
  session,
  onEffort,
}: {
  session: SessionConfig
  onEffort: (effort: Effort | null) => void
}) {
  const label = session.effort ? effortLabel(session.provider, session.effort) : "default"
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]" title="Reasoning effort">
          <Brain className="size-3" />
          <span className="mrr-pill-label">{label}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        <PillOption selected={!session.effort} onClick={() => onEffort(null)}>
          Default effort
        </PillOption>
        {effortsFor(session.provider).map((effort) => (
          <PillOption key={effort} selected={session.effort === effort} onClick={() => onEffort(effort)}>
            {effortLabel(session.provider, effort)}
          </PillOption>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const PERSONA_OPTIONS: Array<{ id: ProductDesignPersona; name: string; description: string }> = [
  { id: "auto", name: "Auto", description: "Route each message to the right persona automatically." },
  { id: "specialist", name: "Specialist", description: "Product Specialist answers: specs, scope, build prompts." },
  { id: "designer", name: "Designer", description: "Product/UI Designer answers: HTML/CSS prototypes." },
]

function PersonaPill({
  persona,
  onPersona,
}: {
  persona: ProductDesignPersona
  onPersona: (persona: ProductDesignPersona) => void
}) {
  const label = PERSONA_OPTIONS.find((p) => p.id === persona)?.name ?? "Auto"
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]" title="Persona">
          <Users className="size-3" />
          <span className="mrr-pill-label">{label}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        {PERSONA_OPTIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
            onClick={() => onPersona(p.id)}
          >
            <Check className={cn("mt-0.5 size-3.5", persona === p.id ? "opacity-100" : "opacity-0")} />
            <span className="grid gap-0.5">
              <span>{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.description}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const ARTIFACT_ICONS = { spec: FileText, prototype: PenNib, prompt: TerminalSquare } as const

function AttachArtifactsPill({ thread }: { thread: Thread }) {
  const attached = useThreadArtifacts(thread.id)
  const setAttached = useSetThreadArtifacts(thread.id)
  const attachedIds = new Set((attached.data ?? []).map((a) => a.id))

  const toggle = (artifact: ArtifactInfo) => {
    const next = attachedIds.has(artifact.id)
      ? [...attachedIds].filter((id) => id !== artifact.id)
      : [...attachedIds, artifact.id]
    setAttached.mutate(next)
  }

  return (
    <ArtifactsPickerPill
      projectId={thread.projectId}
      folderId={thread.folderId}
      attachedIds={attachedIds}
      onToggle={toggle}
    />
  )
}

/** Artifact picker pill with controlled selection — usable before a thread exists. */
export function ArtifactsPickerPill({
  projectId,
  folderId,
  attachedIds,
  onToggle,
}: {
  projectId: string
  folderId: string | null
  attachedIds: Set<string>
  onToggle: (artifact: ArtifactInfo) => void
}) {
  const artifacts = useProjectArtifacts(projectId)
  const threads = useThreads(projectId, true)
  // Only artifacts in the thread's folder scope can be attached.
  const all = scopeArtifacts(artifacts.data ?? [], threads.data ?? [], folderId)
  if (all.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className={cn("rounded-full text-[11px]", attachedIds.size > 0 && "border-primary/50 text-primary")}
          title="Attach product-design artifacts"
        >
          <PenNib className="size-3" />
          {attachedIds.size > 0 && <span className="mrr-pill-label">{attachedIds.size}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Attached artifacts are injected into this thread's runs.
        </p>
        {all.map((artifact) => {
          const Icon = ARTIFACT_ICONS[artifact.kind]
          return (
            <button
              key={artifact.id}
              type="button"
              className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
              onClick={() => onToggle(artifact)}
            >
              <Check className={cn("mt-0.5 size-3.5", attachedIds.has(artifact.id) ? "opacity-100" : "opacity-0")} />
              <Icon className="mt-0.5 size-3.5 text-muted-foreground" />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate">{artifact.title}</span>
                <span className="text-xs capitalize text-muted-foreground">{artifact.kind}</span>
              </span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function AttachedArtifactChips({ thread }: { thread: Thread }) {
  const attached = useThreadArtifacts(thread.id)
  const setAttached = useSetThreadArtifacts(thread.id)
  const list = attached.data ?? []
  return (
    <ArtifactChips
      artifacts={list}
      onDetach={(id) => setAttached.mutate(list.filter((a) => a.id !== id).map((a) => a.id))}
    />
  )
}

/** Chip row for attached artifacts — controlled, usable before a thread exists. */
export function ArtifactChips({
  artifacts,
  onDetach,
}: {
  artifacts: ArtifactInfo[]
  onDetach: (id: string) => void
}) {
  if (artifacts.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {artifacts.map((artifact) => {
        const Icon = ARTIFACT_ICONS[artifact.kind]
        return (
          <span
            key={artifact.id}
            className="inline-flex h-6 max-w-[16rem] items-center gap-1.5 rounded-full border bg-muted/40 px-2 text-xs text-muted-foreground"
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{artifact.title}</span>
            <button
              type="button"
              aria-label={`Detach ${artifact.title}`}
              className="shrink-0 rounded-full hover:text-foreground"
              onClick={() => onDetach(artifact.id)}
            >
              <X className="size-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

function RolePill({ role, onRole }: { role: string; onRole: (role: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="xs" className="rounded-full text-[11px]" title="Agent role">
          <Bot className="size-3" />
          <span className="mrr-pill-label max-w-[12ch] truncate">{roleName(role)}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        {BUILD_ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
            onClick={() => onRole(r.id)}
          >
            <Check className={cn("mt-0.5 size-3.5", role === r.id ? "opacity-100" : "opacity-0")} />
            <span className="grid gap-0.5">
              <span>{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.description}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function PillOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={onClick}>
      <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
      <span>{children}</span>
    </button>
  )
}
