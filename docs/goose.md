```text
ou are doing narrowly scoped architecture research for the v1 browser harness of Career-Ops.

  Your task is to study Goose and extract only the permission and context-engineering patterns relevant to a narrow, low-cost domain harness.

  Read enough of the official docs first, then source only if needed.

  Start here:
  - https://block.github.io/goose/docs/guides/goose-permissions/
  - https://block.github.io/goose/docs/guides/context-engineering/
  - https://block.github.io/goose/docs/getting-started/using-extensions/

  Project context:
  - Repo: /home/mmahabeer/dev/personal/career-ops
  - Read:
    - /home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md
    - /home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md
    - /home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md

  Question to answer:
  What should Career-Ops borrow from Goose around permissions, tool modularity, and context engineering for a browser-first harness?

  Focus on:
  - permission modes
  - extension/tool boundaries
  - context assembly
  - what helps a narrow domain workflow
  - what is not worth copying in v1

  Do not give a broad Goose overview.

  Return exactly this structure:
  1. Patterns to copy
  2. Patterns to avoid
  3. Overkill for v1
  4. Concrete recommendations for Career-Ops
  5. Sources consulted

  Keep it tight:
  - 8-12 bullets total
  - include specific docs or source references where useful
```
----

1. Patterns to copy
- Use Goose's split between session mode and per-tool overrides: Career-Ops should have a small policy matrix, not a binary "agent on/off." Read-only browser/navigation/extraction can auto-run; any third-party state change should require explicit user action; final `submit`/`send`/`apply` stays blocked (`goose Permission Modes`; `Managing Tool Permissions`; repo `AGENTS.md` ethical rule).
- Keep tool boundaries domain-shaped, not DOM-shaped. Goose separates extensions from tools; Career-Ops should expose `scan_portals`, `verify_job_page`, `extract_job`, `evaluate_job`, `generate_pdf`, and `update_tracker`, with Playwright/ATS details hidden underneath (`Using Extensions`; [CHEAP_WEB_STACK.md](/home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md)).

2. Patterns to avoid
- Do not copy Goose's open extension surface into v1. Arbitrary MCP installs, mid-session extension changes, and auto-enabled recommendations are useful for a general agent, but they widen the attack surface and push Career-Ops away from a narrow workflow (`Using Extensions`; `goose Extension Allowlist`).
- Do not expose raw browser verbs as first-class model tools. `click`, `goto`, `run_shell`, or generic `search_web` are the wrong abstraction here; the repo's own stack note already argues for narrow wrappers around discovery, verification, reasoning, PDF generation, and tracker updates ([CHEAP_WEB_STACK.md](/home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md)).

3. Overkill for v1
- Goose's full context stack is more than Career-Ops needs: persistent MOIM instructions, nested hint discovery across directories, skills marketplace, custom slash commands, and cross-session memory. For v1, keep only tiny invariant guardrails plus route/job-specific context packages (`Context Engineering`; `Persistent Instructions`; `Providing Hints to goose`).
- Goose's broader operations layer is also too much: hosted allowlist infrastructure, dynamic extension management, subagents, and tuning across many enabled tools. Keep Playwright traces/screenshots only as internal debugging aids if verification failures become hard to inspect (`goose Extension Allowlist`; `Using Extensions`; Playwright CLI skill tutorial).

4. Concrete recommendations for Career-Ops
- Implement three harness permission classes modeled on Goose's `Always Allow` / `Ask Before` / `Never Allow`: `auto` for read-only discovery/verification/extraction, `confirm` for actions that touch user-owned state or third-party drafts, and `blocked` for final apply/send/submit plus arbitrary external actions (`Managing Tool Permissions`; `goose Permission Modes`; repo `AGENTS.md`).
- Assemble context in three layers: session-start stable repo rules, tiny per-turn guardrails, and route-local artifacts loaded on demand. In practice that means loading repo rules once, then attaching only `cv.md`, `config/profile.yml`, one JD, and optionally one evaluation report for the active workflow, rather than resending the whole tracker or repo each turn (`Providing Hints to goose`; `Persistent Instructions`; [PRD_BROWSER.md](/home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md)).
- Treat each Career-Ops workflow as a local "skill" without importing Goose's full skill runtime: `verify_job_page` = Playwright + selectors + apply-button check, `generate_pdf` = existing `generate-pdf.mjs`, `update_tracker` = TSV addition + `node merge-tracker.mjs`. That borrows Goose's reusable procedure idea while keeping the current repo as the engine ([ARCHITECTURE.md](/home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md); [CHEAP_WEB_STACK.md](/home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md); Playwright CLI skill tutorial).

5. Sources consulted
- Goose docs: `goose Permission Modes`, `Managing Tool Permissions`, `Using Extensions`, `Context Engineering`, `Providing Hints to goose`, `Persistent Instructions`, `MCP Roots`, and the Playwright CLI skill tutorial.
- Career-Ops docs: [DATA_CONTRACT.md](/home/mmahabeer/dev/personal/career-ops/DATA_CONTRACT.md), [PRD_BROWSER.md](/home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md), [ARCHITECTURE.md](/home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md), and [CHEAP_WEB_STACK.md](/home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md).
