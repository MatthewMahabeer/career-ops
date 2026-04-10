You are doing narrowly scoped architecture research for the v1 browser harness of Career-Ops.

Your task is to study OpenCode and extract only the patterns relevant to a cheap, bounded, browser-first domain harness.

Read enough of the official docs first, then read source only where the docs are vague.

Start here:
- https://opencode.ai/docs/agents/
- https://opencode.ai/docs/tools/
- https://opencode.ai/docs/skills/
- https://opencode.ai/docs/config/

Project context:
- Repo: /home/mmahabeer/dev/personal/career-ops
- Read:
  - /home/mmahabeer/dev/personal/career-ops/docs/PRD_BROWSER.md
  - /home/mmahabeer/dev/personal/career-ops/docs/ARCHITECTURE.md
  - /home/mmahabeer/dev/personal/career-ops/docs/CHEAP_WEB_STACK.md

Question to answer:
Which OpenCode patterns are useful for a cheap, bounded, browser-first Career-Ops harness, and which are unnecessary or harmful?

Focus on:
- step limits / cost controls
- primary agent vs subagent split
- permissions and tool boundaries
- skills and task routing
- anything that helps a narrow workflow harness
- anything that would push us toward an overbuilt general agent

Do not give a broad OpenCode overview.

Return exactly this structure:
1. Patterns to copy
2. Patterns to avoid
3. Overkill for v1
4. Concrete recommendations for Career-Ops
5. Sources consulted

Keep it tight:
- 8-12 bullets total
- include specific docs or source references where useful

put your output in /career-ops/docs/opencode.md -- format: the prompt i asked you ---- your assessment.

----

1. Patterns to copy
- Copy hard per-agent `steps` caps. OpenCode's `steps` limit turns an open-ended loop into a bounded run and forces a text-only wrap-up at the limit, which fits a cheap `evaluate` or `apply` server flow better than "keep going until the model stops" ([Agents: Max steps](https://opencode.ai/docs/agents/#max-steps)).
- Copy the orchestrator plus narrow worker split, but only where the child has a different boundary. The useful version here is one primary agent and one hidden, read-only verifier/extractor subagent, with `permission.task` set deny-first so only that worker is invokable ([Agents: Types, Hidden, Task permissions](https://opencode.ai/docs/agents/); [Permissions](https://opencode.ai/docs/permissions/)).

2. Patterns to avoid
- Avoid OpenCode's default stance that all tools are enabled and allowed. That is acceptable for an IDE coding agent, but harmful for Career-Ops because it pushes toward generic `websearch`/`webfetch`/file-edit behavior instead of the domain wrappers already called for in this repo ([Tools](https://opencode.ai/docs/tools/); [Config: Permissions](https://opencode.ai/docs/config/#permissions); [docs/CHEAP_WEB_STACK.md](./CHEAP_WEB_STACK.md)).
- Avoid broad implicit skill discovery. OpenCode walks up the repo and also loads global skills from `~/.config`, `~/.claude`, and `~/.agents`; for a hosted browser harness that is too much ambient behavior, so the app should register only its own narrow route-level skills or handlers ([Skills: Understand discovery, Configure permissions](https://opencode.ai/docs/skills)).

3. Overkill for v1
- Snapshotting, sharing modes, remote config layers, and automatic compaction are CLI/session ergonomics, not core harness primitives. They add admin, disk, or state-management surface without helping the bounded browser workflow in [docs/PRD_BROWSER.md](./PRD_BROWSER.md) ([Config: Locations, Sharing, Snapshot, Compaction](https://opencode.ai/docs/config/)).
- The built-in `build`/`plan`/`general`/`explore` family is more general than v1 needs. Career-Ops is not an end-user coding IDE, and even OpenCode's own `general` subagent is framed as a parallel multi-step worker with broad tool access, which is exactly the direction [docs/CHEAP_WEB_STACK.md](./CHEAP_WEB_STACK.md) warns against ([Agents: Built-in](https://opencode.ai/docs/agents/); [Tools: todowrite](https://opencode.ai/docs/tools/)).

4. Concrete recommendations for Career-Ops
- Model the browser harness as route-sized skills or agents that mirror the repo's existing mode surface, but keep execution behind deterministic server functions: `evaluate`, `apply`, `pdf`, `tracker`, and later `scan`. That matches [docs/ARCHITECTURE.md](./ARCHITECTURE.md) and the existing `plugins/career-ops/skills/*` routing instead of inventing a second orchestration model.
- For v1, use one primary `career-ops-browser` agent with `steps: 4-6`, no generic web search, no raw file editing, and no shell; add at most one hidden `browser-verify` subagent with `steps: 2-3` and read-only page-verification/extraction powers. Keep tracker, report, and PDF writes outside the model loop and run them through the existing deterministic scripts to preserve the [DATA_CONTRACT.md](../DATA_CONTRACT.md) and pipeline rules.

5. Sources consulted
- Official OpenCode docs: [Agents](https://opencode.ai/docs/agents/), [Tools](https://opencode.ai/docs/tools/), [Skills](https://opencode.ai/docs/skills/), [Config](https://opencode.ai/docs/config/), and [Permissions](https://opencode.ai/docs/permissions/). I did not need an OpenCode source dive for this narrow question because those docs were specific enough on `steps`, `permission.task`, skill discovery, and granular permissions.
- Career-Ops local docs and config surface: [docs/PRD_BROWSER.md](./PRD_BROWSER.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md), [docs/CHEAP_WEB_STACK.md](./CHEAP_WEB_STACK.md), [DATA_CONTRACT.md](../DATA_CONTRACT.md), [plugins/career-ops/skills/career-ops-core/SKILL.md](../plugins/career-ops/skills/career-ops-core/SKILL.md), and [plugins/career-ops/skills/career-ops-evaluate/SKILL.md](../plugins/career-ops/skills/career-ops-evaluate/SKILL.md).
