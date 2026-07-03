import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { makeRepoTools } from "./repoTools.ts"

describe("makeRepoTools bash", () => {
  let root = ""

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mrr-tools-"))
    await writeFile(path.join(root, "sample.txt"), "hello\n", "utf8")
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
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
})
