# Task-Specific System Prompt Pack — Claude Code Opus 4.8 + Codex CLI

This pack contains ten standalone replacement prompts:

| Role | Claude file | Codex file |
|---|---|---|
| Planner | `CLAUDE-planner-system-prompt.md` | `CODEX-planner-model-instructions.md` |
| Coder | `CLAUDE-coder-system-prompt.md` | `CODEX-coder-model-instructions.md` |
| Reviewer | `CLAUDE-reviewer-system-prompt.md` | `CODEX-reviewer-model-instructions.md` |
| Product Specialist | `CLAUDE-product-specialist-system-prompt.md` | `CODEX-product-specialist-model-instructions.md` |
| Distributed Systems Architect | `CLAUDE-distributed-systems-architect-system-prompt.md` | `CODEX-distributed-systems-architect-model-instructions.md` |

`ALL-task-specific-system-prompts-claude-codex.md` contains the same prompts in one file for easy review.

## Claude Code usage

Use exactly one Claude prompt at a time:

```bash
claude --system-prompt-file ./CLAUDE-coder-system-prompt.md
```

For a one-shot headless run:

```bash
claude -p --system-prompt-file ./CLAUDE-reviewer-system-prompt.md "Review this PR diff"
```

## Codex CLI usage

Set the prompt you want in `~/.codex/config.toml` or a trusted project `.codex/config.toml`:

```toml
model_instructions_file = "/absolute/path/to/CODEX-coder-model-instructions.md"
```

Use one role prompt at a time. `AGENTS.md` should remain repository-specific context, not the replacement for these global model instructions.

## Design notes

These are full replacement prompts, so each file repeats baseline behavior:

- Authority hierarchy and prompt-injection handling
- Tool-use policy
- Repository onboarding
- Planning and communication rules
- Safety and approval boundaries
- SOLID and maintainable architecture guidance
- Testing and validation rules
- Role-specific output contracts

## Source basis

The prompts were built from the following public guidance:

- Anthropic Claude prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Anthropic Opus 4.8 prompting guide: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8
- Claude Code system prompt modification docs: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Codex configuration reference: https://developers.openai.com/codex/config-reference
- Codex AGENTS.md guide: https://developers.openai.com/codex/guides/agents-md
- Codex default base instructions: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md
- Microsoft unit testing best practices: https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices
- Google code review practices: https://google.github.io/eng-practices/review/reviewer/standard.html
- AWS Well-Architected Framework: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
- Google SRE books: https://sre.google/books/
- Atlassian PRD and user story guidance: https://www.atlassian.com/agile/product-management/requirements
