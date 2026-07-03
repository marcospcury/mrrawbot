import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { findGitDirs, parseGitHub } from "./gitRepos.ts"

describe("parseGitHub", () => {
  it("parses SSH remotes", () => {
    expect(parseGitHub("git@github.com:acme/atlas.git")).toEqual({
      owner: "acme",
      repo: "atlas",
    })
  })

  it("parses HTTPS remotes with and without .git", () => {
    expect(parseGitHub("https://github.com/acme/example-monorepo.git")).toEqual({
      owner: "acme",
      repo: "example-monorepo",
    })
    expect(parseGitHub("https://github.com/addyosmani/agent-skills")).toEqual({
      owner: "addyosmani",
      repo: "agent-skills",
    })
  })

  it("parses ssh:// scheme remotes", () => {
    expect(parseGitHub("ssh://git@github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    })
  })

  it("handles repos with dots and dashes in the name", () => {
    expect(parseGitHub("git@github.com:VoltAgent/awesome-design-md.git")).toEqual({
      owner: "VoltAgent",
      repo: "awesome-design-md",
    })
  })

  it("returns null for non-GitHub or missing remotes", () => {
    expect(parseGitHub(null)).toBeNull()
    expect(parseGitHub("git@gitlab.com:owner/repo.git")).toBeNull()
    expect(parseGitHub("")).toBeNull()
  })
})

describe("findGitDirs", () => {
  let root = ""

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mrr-scan-"))
    // A normal repo that SHOULD be discovered.
    await mkdir(path.join(root, "my-repo", ".git"), { recursive: true })
    // A repo buried in a virtual/VM mount (OrbStack) that MUST be skipped —
    // scanning these exposes entire guest filesystems.
    await mkdir(path.join(root, "OrbStack", "ubuntu", "code", ".git"), { recursive: true })
    // Repos inside dependency/cache dirs must be skipped too.
    await mkdir(path.join(root, "node_modules", "dep", ".git"), { recursive: true })
  })

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it("discovers real repos but skips OrbStack and node_modules", async () => {
    const found = await findGitDirs(root, 6)
    expect(found).toEqual([path.join(root, "my-repo")])
  })
})
