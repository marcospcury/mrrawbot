import { Bot, FolderGit2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function WelcomeScreen({ onAddRepo }: { onAddRepo: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="mrr-header flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger className="text-muted-foreground" />
      </header>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="animate-mrr-in flex max-w-md flex-col items-center text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-card shadow-sm">
            <Bot className="size-8 text-foreground" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome to mrrawbot</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Orchestrate Claude Code, Codex, Ollama Cloud, OpenRouter, Hugging Face, and Cerebras agents
            over your local repositories. Pick a tracked repository to get started.
          </p>
          <Button className="mt-6" onClick={onAddRepo}>
            <FolderGit2 className="size-4" />
            Add a repository
          </Button>
        </div>
      </div>
    </div>
  )
}
