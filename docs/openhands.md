You are doing narrowly scoped architecture research for the v1 browser harness of Career-Ops.

Your task is to study OpenHands and extract only the runtime/orchestration patterns relevant to a resumable backend job system for a browser-first domain product.

Read enough of the official docs first, then source only if needed.

Start here:
- https://docs.all-hands.dev/openhands/usage/architecture/runtime
- https://docs.all-hands.dev/usage/runtimes
- https://docs.openhands.dev/overview/skills/org

Project context:
- Repo: /home/mmahabeer/dev/personal/career-ops
- Read:
  - /home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md
  - /home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md
  - /home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md

Question to answer:
What runtime separation and action/observation patterns should Career-Ops copy from OpenHands for a resumable, backend-driven v1 harness?

Focus on:
- separation between orchestrator and runtime
- action/observation protocol ideas
- resumability and isolation
- backend job execution boundaries
- skills/plugin layering if relevant
- what is too heavy for a small browser-first product

Do not give a broad OpenHands overview.

Return exactly this structure:
1. Patterns to copy
2. Patterns to avoid
3. Overkill for v1
4. Concrete recommendations for Career-Ops
5. Sources consulted

Keep it tight:
- 8-12 bullets total
- include specific docs or source references where useful

----

1. Patterns to copy
- Keep a hard split between the job orchestrator and the execution runtime: the backend owns job state, retries, leases, and persistence; the runtime only executes actions and returns observations. Copy the boundary from OpenHands' runtime/server split and SDK `RemoteConversation`/workspace split, not the whole stack. (Runtime Architecture; SDK Package; Local Agent Server)
- Use a typed action -> observation contract plus an append-only event log. OpenHands' SDK treats tool calls/results as typed pairs and serializable events; that maps well to `verify_job_page`, `extract_jd`, `generate_pdf`, and `update_tracker` actions with normalized observation payloads and correlation IDs. (SDK Package; Events)
- Persist mutable base state separately from event history so jobs can resume cleanly. OpenHands snapshots state and appends events independently; Career-Ops should do the same for crash recovery, reconnects, and long-running jobs. (Persistence; Cloud API status model)

2. Patterns to avoid
- Do not expose a general-purpose agent runtime to the product. OpenHands can justify shell, arbitrary file ops, MCP, repo prep, and broad tool surfaces; Career-Ops should keep the narrow domain-tool boundary already implied by `docs/CHEAP_WEB_STACK.md`.
- Do not let the browser runtime own orchestration decisions or canonical writes. Retries, cancellation, timeout policy, tracker merges, and status normalization should stay in the backend orchestrator, with the runtime treated as disposable.

3. Overkill for v1
- Container-per-user fleets, full remote agent-server deployment modes, and sandbox-provider abstraction are too heavy for a 5-10 user browser product unless browser isolation becomes a real multi-tenant risk. Copy the isolation principle, not the infrastructure. (Agent Server Package; Remote Sandbox)
- Full skills/plugin/MCP layering is overkill. The only part worth copying is the scope model: system defaults + repo/domain instructions + user-owned overrides. Career-Ops already has this shape in `modes/*.md`, `config/profile.yml`, and `modes/_profile.md`. (Organization and User Skills)

4. Concrete recommendations for Career-Ops
- Build a Node job orchestrator with explicit states such as `queued`, `starting_runtime`, `running`, `waiting_for_user`, `succeeded`, `failed`, and `cancelled`, and persist those separately from a `job_events` log; stream events over SSE and support polling fallback. This fits `docs/PRD_BROWSER.md` without copying OpenHands' full conversation server.
- Put Playwright in a narrow runtime worker behind typed actions like `open_job_page`, `extract_job_page`, `confirm_apply_action_present`, `render_pdf`, and `capture_artifact`; each action returns a bounded observation object, and only the orchestrator may call repo scripts like `generate-pdf.mjs`, `merge-tracker.mjs`, or write tracker state. This stays aligned with `docs/ARCHITECTURE.md` and `docs/CHEAP_WEB_STACK.md`.
- Keep instruction layering simple: system mode + user profile/context + job-specific payload. If you add "skills," make them backend-owned domain packs, not arbitrary third-party runtime extensions.

5. Sources consulted
- Local repo docs: `DATA_CONTRACT.md`, `docs/PRD_BROWSER.md`, `docs/ARCHITECTURE.md`, `docs/CHEAP_WEB_STACK.md`.
- OpenHands docs/source: legacy runtime boundary docs (`https://docs.all-hands.dev/openhands/usage/architecture/runtime`) plus current runtime/server docs from Remote Sandbox (`https://docs.openhands.dev/openhands/usage/sandboxes/remote`), SDK Package (`https://docs.openhands.dev/sdk/arch/sdk`), Events (`https://docs.openhands.dev/sdk/arch/events`), Persistence (`https://docs.openhands.dev/sdk/guides/convo-persistence`), Local Agent Server (`https://docs.openhands.dev/sdk/guides/agent-server/local-server`), Cloud API (`https://docs.openhands.dev/openhands/usage/cloud/cloud-api`), Organization and User Skills (`https://docs.openhands.dev/overview/skills/org`), and legacy runtime boundary source `https://github.com/OpenHands/OpenHands/blob/main/openhands/runtime/action_execution_server.py`.
