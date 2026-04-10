# PRD: Browser Harness V1 for Career-Ops

Suggested issue title: `PRD: Browser Harness V1 for Career-Ops`

## Problem Statement

Career-Ops already has a strong file-based CLI workflow for evaluating jobs, generating reports, producing tailored PDFs, and updating the tracker. That workflow is effective for technical users, but it does not translate directly to the browser-first version intended for the author and a small number of non-technical friends.

The browser product needs a v1 harness that preserves the quality and shape of the existing evaluation workflow without turning into a browser clone of Codex or Claude Code. The harness must stay narrow, domain-shaped, cost-sensitive, and understandable. It must avoid open-ended agent loops, avoid exposing generic shell or browser controls, and keep model spend concentrated in the parts of the workflow where reasoning adds real value.

The v1 challenge is to define a browser harness that:

- reuses existing Career-Ops evaluation logic, report shape, PDF pipeline, and tracker discipline where practical
- works for both pasted JD text and job URLs
- is resumable and debuggable
- has explicit workflow boundaries and structured contracts between steps
- keeps user-owned artifacts and system-owned state clearly separated
- is cheap enough for bring-your-own OpenRouter usage

## Solution

Build a narrow, backend-owned browser harness around a bounded evaluation job orchestrator.

The v1 harness should use one explicit workflow for job evaluation:

1. ingest source into an `ExtractedSnapshot`
2. normalize into a `NormalizedJob`
3. evaluate into `EvaluationResultV1`
4. render the repo-compatible markdown report
5. update the tracker asynchronously
6. generate PDF only on explicit user request

The orchestrator should own job state, retries, cancellation, event history, leases, and canonical writes. A narrow runtime worker should handle only typed browser actions for extraction and verification plus a deterministic bounded verifier pass. The runtime should not expose generic browsing, shell execution, arbitrary file editing, or open-ended search.

The browser client should talk to route-sized product actions such as starting an evaluation job, retrying a failed step, cancelling a job, and generating a PDF. Internal step outputs should be structured JSON with versioned schemas. Typed job events should be the canonical streaming protocol, with model token streaming treated as an optional UX overlay rather than the source of truth.

SQLite should own mutable harness state and append-only event history. The filesystem should remain the source of truth for user-owned artifacts and generated artifacts such as the report markdown, tailored PDFs, and the canonical markdown tracker.

## User Stories

1. As a browser-first user, I want to paste a job URL and start an evaluation, so that I can use Career-Ops without touching the terminal.
2. As a browser-first user, I want to paste raw JD text instead of a URL, so that I can still evaluate roles when a job page is difficult to access.
3. As a non-technical user, I want one clear evaluation flow instead of a configurable agent, so that the product feels predictable.
4. As a cost-sensitive user, I want the harness to avoid unnecessary model calls, so that my OpenRouter spend stays low.
5. As a user, I want evaluation progress to stream in real time, so that I know what the system is doing.
6. As a user, I want progress updates to reflect real workflow steps, so that the UI does not feel like fake spinner theater.
7. As a user, I want the system to preserve successful work across interruptions, so that a temporary failure does not force a full rerun.
8. As a user, I want the system to resume from the last valid checkpoint when possible, so that retries are fast and cheap.
9. As a user, I want the evaluation to succeed even if some fields are unknown, so that ordinary JD ambiguity does not block me.
10. As a user, I want the report output to feel consistent with existing Career-Ops evaluations, so that browser and CLI output stay comparable.
11. As a user, I want the system to generate a numbered report only after a successful render, so that report numbering stays clean.
12. As a user, I want my report to be available even if tracker syncing fails, so that downstream projection problems do not destroy a good evaluation.
13. As a user, I want the tracker to update automatically after a successful evaluation, so that I do not have to do extra bookkeeping.
14. As a user, I want PDF generation to be on demand, so that I do not pay extra cost for every evaluation.
15. As a user, I want cancellation to stop the job safely between steps, so that I can back out without corrupting artifacts.
16. As a user, I want failed tracker syncs to be visible and retryable, so that I understand what succeeded and what did not.
17. As a user, I want the system to fall back from rule-based normalization only when needed, so that the harness stays cheap by default.
18. As a user, I want messy sites to get one bounded rescue attempt, so that ordinary extraction failures are handled without turning the tool into a general browser agent.
19. As a user, I want the harness to avoid arbitrary browser actions, so that the product stays safe and narrow.
20. As a user, I want my tracker and reports to remain durable artifacts I can inspect outside the web UI, so that the browser product does not trap my data in a database.
21. As a user, I want the dashboard to query quickly, so that tracker browsing feels like an app rather than a file viewer.
22. As a user, I want the evaluation flow to use the right model for the right job, so that quality and cost stay balanced without extra settings.
23. As a user, I want the system to keep model routing simple and backend-owned, so that I am not asked to tune per-step model settings.
24. As a user, I want verification failures to degrade gracefully, so that I can still paste text or retry instead of hitting a dead end.
25. As a user, I want the system to preserve enough bounded extraction evidence for debugging, so that bad evaluations can be inspected later.
26. As a maintainer, I want the harness internals to use typed contracts between steps, so that retries, testing, and versioning are stable.
27. As a maintainer, I want the browser harness to reuse existing Career-Ops pipelines where practical, so that v1 does not become a rewrite.
28. As a maintainer, I want tracker updates to keep the existing TSV-plus-merge discipline, so that browser and CLI flows respect the same canonical tracker rules.
29. As a maintainer, I want mutable state and event history stored separately, so that job recovery and support are easier.
30. As a maintainer, I want a small but meaningful benchmark corpus, so that routing or prompt changes can be checked before release.

## Implementation Decisions

- Build the harness around a bounded backend job orchestrator rather than an autonomous conversational loop.
- Keep the core evaluation workflow boundary at `report_ready`.
- Treat `update_tracker` as an asynchronous projection after a successful report render.
- Treat `generate_pdf` as an explicit, user-triggered downstream action rather than part of the default evaluation flow.
- Use one canonical ingestion contract for both URLs and pasted JD text by converting both into an `ExtractedSnapshot`.
- Keep internal step contracts typed and versioned, including at minimum `ExtractedSnapshot`, `NormalizedJob`, and `EvaluationResultV1`.
- Make `EvaluationResultV1` JSON the canonical evaluation artifact.
- Make markdown report output a deterministic projection of the canonical evaluation artifact.
- Preserve the existing Career-Ops evaluation and report shape as closely as practical, while allowing the browser harness to add structured intermediate state underneath.
- Split state into `job_state`, `tracker_state`, and `pdf_state` instead of flattening everything into one status field.
- Use a current-state snapshot plus an append-only event log for persistence of harness state.
- Keep SQLite as the system of record for harness-owned mutable state, retries, cancellation, leases, artifact references, step outputs, and event history.
- Keep the filesystem as the system of record for user-owned and generated artifacts, including report markdown, tailored PDFs, and the canonical markdown tracker.
- Keep the canonical tracker in markdown form and continue using the existing tracker-addition plus merge flow rather than direct row insertion.
- Maintain a derived SQLite read model for dashboard querying rather than making SQLite the canonical tracker.
- Use route-sized external product actions rather than exposing internal step APIs directly to the client.
- Use narrow typed runtime actions for browser work and hide implementation details behind the orchestrator.
- Allow one deterministic bounded verifier pass for extraction and verification only.
- Keep the verifier deterministic, with a small allowlist of alternate tactics, and do not allow model-directed browser behavior.
- Make normalization deterministic-first with one bounded model fallback when required fields or confidence are insufficient.
- Require `NormalizedJob` to meet a small core schema before evaluation proceeds, while carrying the rest of the fields as explicit unknowns rather than invented guesses.
- Keep model routing system-owned rather than user-configured per step.
- Bias model usage toward cheap classification and normalization, tool-aware runtime support where needed, and stronger reasoning for evaluation.
- Use layered cost controls: fixed workflow boundaries, retry caps, bounded evidence size, and model allowlists per step.
- Treat typed SSE events as canonical for workflow progress and job state.
- Allow token streaming as an optional overlay for user-facing reasoning rather than the authoritative state source.
- Use dual identifiers: an opaque job identifier for orchestration and a per-user sequential report number for human-facing artifacts.
- Allocate the human-facing report number only when report rendering successfully commits.
- Treat starting an evaluation as implicit authorization for report creation and tracker update.
- Require explicit user action for PDF generation.
- Keep final apply/send/submit actions outside the harness and blocked in v1.
- Support soft cancellation that takes effect between steps rather than hard cancellation in the middle of a step.
- Keep retries step-scoped with bounded budgets so successful earlier work is not discarded.
- Defer the detailed taxonomy of transient versus permanent failure classification to a follow-on design pass before implementation starts.
- Give each browser user a repo-compatible logical workspace root so the harness can reuse existing system scripts and artifact shapes through a small compatibility layer instead of a rewrite.

## Testing Decisions

- Good tests should validate observable behavior and stable contracts rather than internal implementation details.
- Contract tests should verify that step inputs and outputs conform to their schemas and reject malformed payloads cleanly.
- Fixture-based pipeline tests should cover representative URL and pasted-text flows through extraction packaging, normalization, evaluation artifact generation, and report rendering.
- Renderer tests should verify that a canonical evaluation artifact consistently produces the expected report sections and tracker projection payloads.
- Tracker projection tests should verify that projection failures do not corrupt the successful evaluation state and that retries preserve canonical tracker discipline.
- Orchestrator tests should verify step ordering, checkpoint persistence, retry boundaries, soft cancellation, projection separation, and state recovery from saved snapshots and event history.
- Streaming tests should verify that typed event ordering remains stable and that token streaming never becomes the authoritative state channel.
- Runtime tests should verify only the narrow typed actions and deterministic verifier behavior, not arbitrary browser control.
- Live browser smoke tests should cover a very small representative set of real job pages for extraction and verification health.
- Release-gated benchmark runs should use a small golden corpus of representative jobs to compare schema validity, render success, latency, estimated spend, and human quality notes before significant routing or prompt changes ship.
- Prior art should come from the existing Career-Ops emphasis on pipeline integrity, deterministic artifact generation, tracker merge discipline, and health-check style validation rather than implementation-detail-heavy unit tests.
- The strongest early test targets should be the evaluation job orchestrator, extraction and normalization pipeline, report renderer and artifact writer, and tracker projection plus merge and index sync.

## Issue #3 Contract Decisions

The v1 extraction and normalization boundary is now concrete in `harness/contracts.mjs`.

- `ExtractedSnapshot` v1 is the shared ingestion output for both URLs and pasted JD text. It carries source metadata, extraction metadata, and one canonical `content.rawText` payload for downstream normalization.
- `NormalizedJob` v1 separates normalized structure from evidence. The structure is grouped into `identity`, `classification`, and `content`; supporting snippets live in a bounded `evidence` array with snapshot linkage and locator metadata.
- Missing or ambiguous facts use an explicit `{ kind: "unknown", reason, note? }` object. `null` is reserved for structurally absent values such as `source.url` on pasted-text ingestion, not for "we did not find this fact."
- Evaluation may proceed only when normalization has a known company name, a known role title, at least one substantive content signal (`summary`, `responsibilities`, or `requirementsMust`), and minimum confidence above the configured thresholds.
- Evidence is intentionally bounded: limited item count, limited quote size, and required provenance back to the originating extracted snapshot. The normalized contract is not allowed to smuggle the full JD forward as "evidence."
- Deterministic normalization stays the default path. A bounded fallback is eligible only when the extracted snapshot is structurally valid and substantive enough to justify a rescue pass, but deterministic normalization still misses core identity/content or lands below confidence thresholds.

## Out of Scope

- Building a browser clone of Codex, Claude Code, or any general-purpose shell or browser agent
- Exposing generic browser verbs, shell commands, arbitrary file editing, or open-ended search to the model
- Full portal scanning and scheduled crawl infrastructure
- Full batch evaluation orchestration for the browser product
- Broad plugin or skill discovery inside the browser harness
- Fully general recovery for hostile or highly unusual job sites
- Automatic PDF generation after every evaluation
- Final application submission, recruiter outreach sending, or any other irreversible external action
- A large eval platform, dashboard-heavy experimentation system, or continuous model scorecard infrastructure
- User-configurable per-step model routing
- Deep rework of the existing evaluation/report semantics when parity is practical

## Further Notes

- The harness should stay intentionally narrow even when extraction fails on edge-case sites. The fallback for those cases should usually be bounded verifier behavior, normalization fallback, explicit failure states, and user re-entry via pasted text rather than broader browser autonomy.
- The mixed streaming protocol should be designed so reconnecting clients can recover from canonical job state and event history without needing token history replay.
- The PRD intentionally leaves detailed transient-versus-permanent failure classification open for a short follow-on design pass before implementation. That choice should be made deliberately because it affects retries, supportability, and UI messaging.
- The browser product should continue to feel like Career-Ops behind a web UI rather than a new product with unrelated evaluation semantics.
