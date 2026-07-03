---
name: security-review-checklist
description: Security review of code changes — trust boundaries, injection, secrets, authz, unsafe deserialization, dependency and filesystem risks.
---

# Security review checklist

Security review is about trust boundaries: find every place the change lets data or control cross from a less-trusted source into a more-trusted context, and check what stands guard there. Report findings with a concrete attack scenario, not a category name.

## Map the boundaries first

For the code under review, identify where these enter: user input (UI, API params, headers, cookies), files and file paths, environment/config, database contents, network responses, subprocess output, third-party webhooks, LLM/agent output used to take actions. Everything from these sources is attacker-influenced until validated. Validate at the boundary — inside, trust the types.

## Injection (in all its forms)

- **SQL**: parameterized queries only; flag any string concatenation/interpolation into SQL, including ORDER BY / identifier positions that parameters can't cover (use allowlists there).
- **Command**: flag shell string interpolation (`sh -c`, backticks, `exec` with a composed string). Prefer argv arrays; if shell is unavoidable, allowlist-validate the interpolated parts. Watch argument injection too (input starting with `-`).
- **Path traversal**: any path built from external input — resolve to absolute and verify it stays under the intended root (mind `..`, absolute inputs, symlinks); flag naive `startsWith` checks on unresolved paths.
- **XSS / HTML**: unescaped interpolation into HTML/attributes/JS (`dangerouslySetInnerHTML`, `innerHTML`, template strings into the DOM). Escape by default; sanitize only where rich content is the feature.
- **Others by context**: header/log injection (CR/LF in logged input), regex injection & catastrophic backtracking (ReDoS), prototype pollution from merged untrusted objects, XXE on XML parsers, SSRF on any URL fetched server-side from user input (validate scheme/host; block internal ranges when applicable).

## Secrets

- No credentials, tokens, or API keys hardcoded, committed, logged, or echoed into error messages/stack traces sent to clients.
- Secrets read from the platform's intended store; not passed via command lines (visible in process lists) or world-readable files.
- Watch for secrets leaking into: debug logs, telemetry, crash reports, LLM prompts, git history (a removed secret is still compromised — flag for rotation).

## AuthN / AuthZ

- Every state-changing endpoint checks authorization on the server, per-object ("can THIS user act on THIS resource"), not just per-role; flag checks done only in the UI.
- IDOR: sequential/guessable IDs fetched without ownership checks.
- Mass assignment: request bodies bound directly onto models (can a caller set `isAdmin`, `ownerId`?). Bind explicit allowlisted fields.
- CSRF on cookie-authenticated state changes; open redirects on user-supplied return URLs.

## Data handling

- **Deserialization**: never feed untrusted data to formats that can execute or instantiate (pickle, `yaml.load` without SafeLoader, Java native serialization, `eval`/`Function` on data).
- Sensitive data (passwords, tokens, PII) encrypted or hashed appropriately (passwords: bcrypt/scrypt/argon2 — never plain or fast hashes), excluded from logs, and not returned by "get" endpoints that don't need it.
- Crypto: no home-rolled algorithms or bare `Math.random()` for anything security-relevant; constant-time comparison for secret comparison.

## Platform & dependencies

- New/changed dependencies: are they necessary, maintained, and not typosquats? Lockfile updated deliberately, not wholesale?
- Subprocess and file operations run with the least surprising scope (no chmod 777, no writing outside app-owned dirs, temp files created safely).
- Error handling that swallows security failures (catch-all around an auth check) — fail closed, not open.

## Reporting

For each finding: the boundary crossed, a concrete attack ("a repo path containing `../` reaches `fs.rm` at foo.ts:42 and deletes outside the workspace"), severity honestly rated by exploitability × impact, and the standard fix. If the codebase is a local single-user tool, say which findings are theoretical in that threat model rather than inflating them — but still report them.

## Further reading

- OWASP Top 10 (owasp.org/Top10) and OWASP ASVS — the canonical checklists
- OWASP Cheat Sheet Series — per-topic concrete guidance (cheatsheetseries.owasp.org)
- CWE Top 25 — cwe.mitre.org
