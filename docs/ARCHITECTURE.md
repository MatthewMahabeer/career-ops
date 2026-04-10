# Architecture

## System Overview

```
                    ┌─────────────────────────────────────┐
                    │         Claude Code Agent           │
                    │   (CLAUDE.md + .claude/skills/*)    │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │            Codex Agent               │
                    │  (AGENTS.md + plugins/career-ops/*)  │
                    └────────────────┬────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            │                        │                        │
     ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼────────┐
     │ Single Eval  │         │ Portal Scan │         │ Batch Process  │
     │ auto-pipeline│         │  scan.md    │         │ batch-runner   │
     └──────┬──────┘         └──────┬──────┘         └──────┬────────┘
            │                        │                        │
            │                 ┌──────▼──────┐          ┌──────▼──────┐
            │                 │ pipeline.md │          │ batch prompt │
            │                 │ URL inbox   │          │ + workers    │
            │                 └──────┬──────┘          └──────┬──────┘
            │                        │                        │
     ┌──────▼────────────────────────▼────────────────────────▼──────┐
     │                        Output Pipeline                         │
     │   report.md        PDF via Playwright        tracker TSV       │
     └──────────────────────────────┬─────────────────────────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │ data/applications.md │
                         │ canonical tracker    │
                         └──────────────────────┘
```

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (1 of 6 types)
4. **Evaluate**: 6 blocks (A-F):
   - A: Role summary
   - B: CV match (gaps + mitigation)
   - C: Level strategy
   - D: Comp research (WebSearch)
   - E: CV personalization plan
   - F: Interview prep (STAR stories)
5. **Score**: Weighted average across 10 dimensions (1-5)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`generate-pdf.mjs`)
8. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged

## Batch Processing

The batch system processes multiple offers in parallel:

```
batch-input.tsv    →  batch-runner.sh  →  N × claude -p workers
(id, url, source)     (orchestrator)       (self-contained prompt)
                           │
                    batch-state.tsv
                    (tracks progress)
```

Each worker is a headless Claude instance (`claude -p`) that receives the full `batch-prompt.md` as context. Codex support does not replace this batch engine; it routes users into the same existing flow. Workers produce:
- Report .md
- PDF
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Data Flow

```
cv.md                    →  Evaluation context
article-digest.md        →  Proof points for matching
config/profile.yml       →  Candidate identity
portals.yml              →  Scanner configuration
templates/states.yml     →  Canonical status values
templates/cv-template.html → PDF generation template
```

## Dual-Agent Surface

- Claude keeps the slash-command router in `.claude/skills/career-ops/SKILL.md`.
- Codex uses `AGENTS.md` plus the repo-local plugin in `plugins/career-ops/`.
- Both agents load the same `modes/*.md`, templates, scripts, and data files.
- User-specific changes belong in the user layer from `DATA_CONTRACT.md`, not in system prompts.

## Browser Harness Foundation

The browser-first work now starts with the harness rather than the UI shell.

- `harness/` holds the browser harness lifecycle, SQLite store, and orchestrator surface.
- `data/browser-harness.sqlite` is the mutable runtime database for harness-owned state.
- Mutable harness state is split into `job_state`, `tracker_state`, and `pdf_state`.
- Current job snapshots and checkpoints live in SQLite tables; append-only event history is stored separately.
- Route-sized actions are represented in code as `startEvaluationJob`, `retryJobFromCheckpoint`, and `requestCancellation` on the harness orchestrator.
- Existing repo outputs remain canonical: reports still render to `reports/`, tracker updates still flow through TSV additions plus `merge-tracker.mjs`, and PDFs still reuse `generate-pdf.mjs`.

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Pipeline Integrity

Scripts maintain data consistency:

| Script | Purpose |
|--------|---------|
| `merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `normalize-statuses.mjs` | Maps status aliases to canonical values |
| `cv-sync-check.mjs` | Validates setup consistency |

## Dashboard TUI

The `dashboard/` directory contains a standalone Go TUI application that visualizes the pipeline:

- Filter tabs: All, Evaluada, Aplicado, Entrevista, Top >=4, No Aplicar
- Sort modes: Score, Date, Company, Status
- Grouped/flat view
- Lazy-loaded report previews
- Inline status picker
