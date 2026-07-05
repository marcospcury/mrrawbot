import type { ComponentProps, ComponentType, ReactNode } from "react"
import { CircleDot, GitCommitHorizontal, GitPullRequest, Globe, Link2, Workflow } from "lucide-react"

/**
 * Markdown anchor renderer shared by chat messages, artifact docs, and .md
 * file previews. Labeled links ("[text](url)") stay inline text links, styled
 * by the .mrr-markdown rules in index.css. Bare URLs — which markdown
 * autolinks with the full URL as the visible text — render as a compact chip
 * with an icon and a readable label instead of the raw URL string.
 */
export function MarkdownLink({ children, node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  const href = props.href ?? ""
  const text = renderedText(children).trim()
  const isBareUrl =
    href.length > 0 &&
    (text === href || `${text}/` === href || text === href.replace(/^https?:\/\//, "").replace(/\/$/, ""))

  if (!isBareUrl) {
    return (
      <a className="copilotKitMarkdownElement" {...props} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }

  const { Icon, primary, secondary } = describeLink(href)
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      className="mrr-link-chip inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 align-middle text-[0.8125em] font-medium text-foreground no-underline transition-colors hover:border-ring/40 hover:bg-accent"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{primary}</span>
      {secondary && <span className="truncate font-normal text-muted-foreground">{secondary}</span>}
    </a>
  )
}

function renderedText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(renderedText).join("")
  if (node && typeof node === "object" && "props" in node)
    return renderedText((node as { props: { children?: ReactNode } }).props.children)
  return ""
}

interface LinkChipLabel {
  Icon: ComponentType<{ className?: string }>
  primary: string
  secondary?: string
}

function describeLink(href: string): LinkChipLabel {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { Icon: Link2, primary: middleTruncate(href, 40) }
  }
  const host = url.hostname.replace(/^www\./, "")
  if (host === "github.com") return describeGithubLink(url)
  const path = url.pathname.replace(/\/$/, "")
  return { Icon: Globe, primary: host, secondary: path ? middleTruncate(path, 34) : undefined }
}

function describeGithubLink(url: URL): LinkChipLabel {
  const [owner, repo, kind, ...rest] = url.pathname.split("/").filter(Boolean)
  if (!owner || !repo) return { Icon: GithubMark, primary: "github.com" }
  switch (kind) {
    case "pull":
      return { Icon: GitPullRequest, primary: `${repo} #${rest[0]}`, secondary: "Pull request" }
    case "issues":
      return rest[0]
        ? { Icon: CircleDot, primary: `${repo} #${rest[0]}`, secondary: "Issue" }
        : { Icon: GithubMark, primary: `${owner}/${repo}`, secondary: "Issues" }
    case "commit":
      return { Icon: GitCommitHorizontal, primary: `${repo}@${(rest[0] ?? "").slice(0, 7)}`, secondary: "Commit" }
    case "actions":
      return { Icon: Workflow, primary: repo, secondary: rest[0] === "runs" ? "Actions run" : "Actions" }
    case "releases":
      return { Icon: GithubMark, primary: `${repo} ${rest[1] ?? ""}`.trim(), secondary: "Release" }
    case undefined:
      return { Icon: GithubMark, primary: `${owner}/${repo}` }
    default:
      return { Icon: GithubMark, primary: `${owner}/${repo}`, secondary: middleTruncate([kind, ...rest].join("/"), 24) }
  }
}

function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.ceil(max / 2) - 1)}…${value.slice(-Math.floor(max / 2))}`
}

/** GitHub's mark (octicons mark-github, MIT) — lucide dropped brand icons. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}
