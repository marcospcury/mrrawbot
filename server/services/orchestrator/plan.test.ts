import { describe, expect, it } from "vitest"
import { parsePlan } from "./plan.ts"

describe("parsePlan", () => {
  it("extracts the last plan-json fenced block", () => {
    const plan = parsePlan(`
ignore
\`\`\`plan-json
{"summary":"old","steps":[{"id":1,"title":"Old","prompt":"old"}]}
\`\`\`
final
\`\`\`plan-json
{"summary":"Build it","steps":[{"id":1,"title":"Add API","prompt":"Create endpoint","files":["server/api.ts"],"verify":"curl it"}]}
\`\`\`
`)
    expect(plan).toEqual({
      summary: "Build it",
      steps: [{ id: 1, title: "Add API", prompt: "Create endpoint", files: ["server/api.ts"], verify: "curl it" }],
    })
  })

  it("falls back to markdown step headings", () => {
    const plan = parsePlan(`
Overview paragraph.

## Step 1: Add parser
Create the parser.

### 2. Test parser
Add regression tests.
`)
    expect(plan?.summary).toBe("Overview paragraph.")
    expect(plan?.steps.map((s) => ({ id: s.id, title: s.title, prompt: s.prompt }))).toEqual([
      { id: 1, title: "Add parser", prompt: "Create the parser." },
      { id: 2, title: "Test parser", prompt: "Add regression tests." },
    ])
  })

  it("returns null for garbage input", () => {
    expect(parsePlan("not a plan")).toBeNull()
  })
})
