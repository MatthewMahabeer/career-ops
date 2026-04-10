Aider Research Agent

  You are doing narrowly scoped architecture research for the v1 browser harness of Career-Ops.

  Your task is to study Aider and extract only the patterns relevant to separating reasoning from rendering/formatting in a constrained domain workflow.

  Read enough of the official docs first, then source only if needed.

  Start here:
  - https://aider.chat/docs/
  - https://aider.chat/2024/09/26/architect.html
  - https://aider.chat/docs/repomap.html
  - https://aider.chat/docs/scripting.html

  Project context:
  - Repo: /home/mmahabeer/dev/personal/career-ops
  - Read:
    - /home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md
    - /home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md
    - /home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md

  Question to answer:
  What should Career-Ops borrow from Aider for a v1 harness, especially around separating reasoning from output generation and keeping context small?

  Focus on:
  - architect/editor split
  - small-context patterns
  - structured output vs reasoning separation
  - scripting/one-shot workflow patterns
  - what is useful for evaluation -> report generation
  - what is coding-specific and should not be copied

  Do not give a broad Aider overview.

  Return exactly this structure:
  1. Patterns to copy
  2. Patterns to avoid
  3. Overkill for v1
  4. Concrete recommendations for Career-Ops
  5. Sources consulted

  Keep it tight:
  - 8-12 bullets total
  - include specific docs or source references where useful

put your output in /career-ops/docs/aider.md -- format: the prompt i asked you ---- your assessment.

----

1. Patterns to copy
- Use a two-pass harness: pass 1 does fit reasoning in whatever internal form is natural, pass 2 turns that into strict artifacts. That is the transferable part of Aider's Architect/Editor split, where one model solves and another only formats/applies output (`architect.html`, esp. the motivation and the 2-step split).
- Keep a compact, always-available context map instead of shoving full files into every request. Aider's repo map sends only the key definitions plus critical lines, then fetches more only when needed; Career-Ops should do the same with a small candidate/job/workflow summary pack (`repomap.html`).
- Make modes explicit. Aider separates `/ask`, `/code`, `/architect`, `/read-only`, and `/drop`; Career-Ops should likewise separate evaluate, verify, and render modes so the model is not reasoning, browsing, and formatting in the same turn (`usage/commands.html`).

2. Patterns to avoid
- Do not copy code-edit output formats, diff synthesis, or git-centered loops. Those exist because Aider must patch source files; Career-Ops needs stable report sections, tracker rows, and PDF inputs, not patch text (`architect.html`; local fit: `docs/ARCHITECTURE.md`).
- Do not expose generic operator controls as product primitives. Aider's `/add`, `/drop`, `/run`, and `/web` are useful for a coding assistant, but your own stack note is right: hide that behind narrow domain tools like `verify_job_page`, `evaluate_job`, `generate_pdf`, and `update_tracker` (`usage/commands.html`; `docs/CHEAP_WEB_STACK.md`).

3. Overkill for v1
- A dynamic graph-ranked global map is more machinery than v1 needs. Borrow the principle, not the implementation: start with fixed compact digests and targeted fetch, and only add smarter ranking if prompts actually bloat (`repomap.html`; `docs/PRD_BROWSER.md`).
- Benchmark-driven Architect/Editor model pairings are also overkill for now. The valuable idea is separation of reasoning from formatting; v1 can do that with one model in two passes before adding multi-model routing (`architect.html`).

4. Concrete recommendations for Career-Ops
- Implement `evaluate_job` as `reason -> normalize -> render`: hidden evaluator output should be a bounded schema like `job_facts`, `fit_claims`, `evidence_refs`, `risks`, `score_inputs`, and `report_outline`; only the renderer writes `reports/*.md`, TSV additions, or PDF payloads. This matches the repo's existing evaluation/report/tracker pipeline (`docs/ARCHITECTURE.md`, `modes/oferta.md`).
- Keep a hard context budget with a reusable "evaluation map": CV/profile digest, archetype rubric, report template headings, canonical status list, normalized JD facts, and last-run artifacts. Full `cv.md`, prior reports, or raw pages should be pulled only on demand and treated as read-only context (`repomap.html`; `usage/commands.html`; `docs/CHEAP_WEB_STACK.md`).
- Use one-shot backend jobs the way Aider uses `--message`: each endpoint should do one bounded task, stream progress, persist artifacts, and exit. That fits your SSE plan and keeps orchestration simple for `evaluate`, `apply`, and `generate PDF` routes (`scripting.html`; `docs/PRD_BROWSER.md`).

5. Sources consulted
- Career-Ops docs: `DATA_CONTRACT.md`, `docs/PRD_BROWSER.md`, `docs/ARCHITECTURE.md`, `docs/CHEAP_WEB_STACK.md`.
- Official Aider docs: `https://aider.chat/2024/09/26/architect.html`, `https://aider.chat/docs/repomap.html`, `https://aider.chat/docs/scripting.html`, and `https://aider.chat/docs/usage/commands.html`.
