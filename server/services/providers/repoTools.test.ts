import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeRepoTools } from "./repoTools.ts"

describe("makeRepoTools bash", () => {
  let root = ""
  const fixtures: string[] = []

  const addTmpDir = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mrr-tools-"))
    fixtures.push(dir)
    return dir
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mrr-tools-"))
    fixtures.push(root)
    await writeFile(path.join(root, "sample.txt"), "hello\n", "utf8")
  })

  afterEach(async () => {
    await Promise.all(fixtures.map((f) => rm(f, { recursive: true, force: true })))
    fixtures.length = 0
  })

  it("exposes bash and runs commands from the repository root", async () => {
    const bash = makeRepoTools(root).find((t) => t.name === "bash")

    expect(bash).toBeDefined()
    const resolvedRoot = await realpath(root)
    const result = String(
      await bash!.invoke({
        command: 'printf "cwd=%s\\nfile=%s\\n" "$PWD" "$(cat sample.txt)"',
        timeoutMs: 5_000,
      }),
    )

    expect(result).toContain("exit_code: 0")
    expect(result).toContain(`cwd=${resolvedRoot}`)
    expect(result).toContain("file=hello")
  })

  it("returns non-zero exit code and stderr instead of throwing", async () => {
    const bash = makeRepoTools(root).find((t) => t.name === "bash")

    const result = String(await bash!.invoke({ command: 'echo "nope" >&2; exit 7', timeoutMs: 5_000 }))

    expect(result).toContain("exit_code: 7")
    expect(result).toContain("stderr:")
    expect(result).toContain("nope")
  })

  it("terminates commands that exceed the timeout", async () => {
    const bash = makeRepoTools(root).find((t) => t.name === "bash")

    const result = String(await bash!.invoke({ command: "sleep 2", timeoutMs: 1_000 }))

    expect(result).toContain("signal: SIGTERM")
    expect(result).toContain("Command timed out after 1000ms.")
  })

  it("reads absolute file paths from the repo, workspace, and uploads roots", async () => {
    const workspace = await addTmpDir()
    const uploads = await addTmpDir()
    await writeFile(path.join(workspace, "workspace.txt"), "from workspace\n", "utf8")
    await writeFile(path.join(uploads, "upload.txt"), "from uploads\n", "utf8")

    const tools = makeRepoTools(root, undefined, workspace, uploads)
    const readFile = tools.find((t) => t.name === "read_file")

    expect(readFile).toBeDefined()
    expect(await readFile!.invoke({ path: path.join(root, "sample.txt") })).toBe("hello\n")
    expect(await readFile!.invoke({ path: path.join(workspace, "workspace.txt") })).toBe("from workspace\n")
    expect(await readFile!.invoke({ path: path.join(uploads, "upload.txt") })).toBe("from uploads\n")
  })

  it("rejects absolute paths outside repo, workspace, and uploads", async () => {
    const outside = await addTmpDir()
    await writeFile(path.join(outside, "outside.txt"), "nope\n", "utf8")

    const tools = makeRepoTools(root, undefined, undefined, undefined)
    const readFile = tools.find((t) => t.name === "read_file")

    const result = String(await readFile!.invoke({ path: path.join(outside, "outside.txt") }))
    expect(result).toContain("Error: Path escapes the repository")
  })

  it("lists a folder using an absolute uploads path", async () => {
    const uploads = await addTmpDir()
    await writeFile(path.join(uploads, "upload-1.txt"), "one\n", "utf8")

    const tools = makeRepoTools(root, undefined, undefined, uploads)
    const listDir = tools.find((t) => t.name === "list_dir")

    const result = String(await listDir!.invoke({ path: uploads }))
    expect(result).toContain("upload-1.txt")
  })

  it("searches via grep using an absolute uploads path", async () => {
    const uploads = await addTmpDir()
    await writeFile(path.join(uploads, "upload-grep.txt"), "needle line\n", "utf8")

    const tools = makeRepoTools(root, undefined, undefined, uploads)
    const grep = tools.find((t) => t.name === "grep")

    const result = String(await grep!.invoke({ query: "needle", path: uploads }))
    expect(result).toContain("upload-grep.txt:1:needle line")
  })

  it("searches with the built-in fallback when ripgrep is unavailable", async () => {
    const uploads = await addTmpDir()
    await writeFile(path.join(uploads, "upload-fallback.txt"), "needle fallback\n", "utf8")

    const tools = makeRepoTools(root, undefined, undefined, uploads)
    const grep = tools.find((t) => t.name === "grep")
    const originalPath = process.env.PATH
    process.env.PATH = ""

    try {
      const result = String(await grep!.invoke({ query: "needle", path: uploads }))
      expect(result).toContain("upload-fallback.txt:1:needle fallback")
    } finally {
      process.env.PATH = originalPath
    }
  })
})
