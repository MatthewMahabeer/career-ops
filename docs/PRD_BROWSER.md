# PRD: Browser-First Career-Ops

**Status:** Draft
**Date:** 2026-04-07
**Author:** Matthew Mahabeer

---

## Vision

Extend career-ops for users in the browser who don't use CLI tools like Claude Code or Codex. A small, personal tool for the author and close friends. Not a commercial product.

Users bring their own OpenRouter API key. The system uses the same evaluation engine, scoring logic, and CV generation pipeline as CLI career-ops, but behind a web UI with a lightweight harness layer.

## Delivery Order

The implementation order is now explicitly harness-first:

1. Lock the browser harness lifecycle, state model, and persistence contracts.
2. Build the browser/server shell around those contracts.
3. Layer UI routes and interaction design on top of the stable harness.

---

## Users

- The author (Matthew) and close friends (~5-10 people)
- Non-technical users who won't use a terminal
- Each user provides their own OpenRouter API key (they pay their own LLM costs)
- Access gated by invite codes distributed personally

---

## Scope: v1

### In scope

| Feature | Description |
|---------|-------------|
| **Evaluate offer** | Paste a JD (text) and receive the full A-F evaluation, streamed |
| **Apply assistant** | Paste form questions from a job application, get tailored answers based on evaluation + CV |
| **View tracker** | Sortable, filterable table of all evaluated offers |
| **Generate PDF** | On-demand ATS-optimized CV per evaluation (button on evaluation result) |
| **Onboarding** | Upload CV (PDF/DOCX/MD) + LLM converts to .md + chat Q&A for clarification |
| **Chat drawer** | Contextual right-panel chat available across pages |

### Out of scope (future)

| Feature | Notes |
|---------|-------|
| Portal scanning | Needs Playwright + scheduled infra. Parked. |
| Batch evaluation | Sequential queue could be v1.5. Full parallel workers parked. |
| Compare offers | Can be handled via chat drawer for now |
| Deep research | Can be handled via chat drawer for now |
| Email magic links | Backlog. 30-day cookie for now, email for long-term persistence later. |

---

## Pages / Routes

```
/                  Landing / login (invite code + OpenRouter key)
/onboarding        Chat-based CV upload + profile setup (first time only)
/dashboard         Tracker table (sort, filter, search)
/evaluate          Paste JD textarea, streams evaluation in main panel
/evaluate/:id      View a past evaluation report
/apply/:id         Apply assistant for a specific evaluation (chat-based)
/settings          Profile, API key, model picker, deal-breakers
```

---

## Architecture Decisions

### Frontend

- **Framework:** SvelteKit
- **Responsive:** Desktop-first, mobile-friendly
- **Streaming:** All LLM responses stream via SSE (evaluations, chat, onboarding)

### Backend

- **Hosting:** Single VPS (Hetzner, Fly.io, or Railway, ~$5-7/mo)
- **Runtime:** Node.js (SvelteKit server routes)
- **PDF generation:** Playwright/Chromium on the VPS, reusing existing `generate-pdf.mjs`

### Data storage: hybrid

**SQLite** (one shared database via Node's built-in `node:sqlite`):
- `users` (id, invite_code, username, openrouter_key_encrypted, created_at)
- `applications` (id, user_id, company, role, score, status, date, report_path, pdf_path, notes)
- `codes` (code, created_by, used_by, active, created_at)
- `sessions` (token, user_id, expires_at)

**Filesystem** (per user):
```
data/users/{id}/
  cv.md
  profile.yml
  _profile.md
  reports/
  output/
```

SQLite handles queryable metadata (tracker filtering/sorting). Files hold content consumed by LLM prompts (CV, reports, PDFs).

### Auth & sessions

- **Gate:** Invite code + OpenRouter API key, both required on first visit
- **Session:** HTTP-only secure cookie, 30-day expiry
- **Invite management:** CLI script (`node manage-codes.mjs create/revoke`), codes in SQLite
- **API key storage:** Server-side only (SQLite), never exposed to client JS
- **Backlog:** Info banner about 30-day persistence + email magic link option for longer sessions

### Models (locked list)

- Gemini 3.1 Flash
- Kimi K2.5
- MiniMax M2.7

User selects from dropdown in `/settings`. No custom model IDs.

### Evaluation harness

**Status: Research complete. Harness foundation implementation starts first.**

The CLI version uses Claude Code as a full agent harness (tool-use loops, self-correction, web search). The browser version uses a narrower backend-owned harness layer between the API and the user.

The canonical harness decisions now live in `docs/PRD_BROWSER_HARNESS_V1.md`, and the first implementation slice is the orchestrator plus state/event schema in `harness/`.

Approach remains SSE for browser progress streaming, but the harness internals are no longer open-ended: typed step contracts, split mutable state, and append-only job events are the foundation.

---

## Visual Design

### Typography

- **Headings:** Fraunces (variable, optical size axis)
- **Body:** Commit Mono

### Color: ink palette

Warm grays with a single red-orange spot color.

| Token | Value | Use |
|-------|-------|-----|
| `--ink-darkest` | `#1c1c1c` | Primary text |
| `--ink-dark` | `#3a3a3a` | Secondary text |
| `--ink-mid` | `#6b6b6b` | Muted text, borders |
| `--ink-light` | `#d4d4d4` | Dividers, subtle borders |
| `--ink-lightest` | `#fafafa` | Backgrounds |
| `--ink-paper` | `#f5f3f0` | Card/surface backgrounds |
| `--spot` | `#d4553a` | Accent: buttons, scores, active states, links |

Light mode default. Dark mode not in v1 scope.

### Personality

"Artistic and autistic" -- obsessively precise, systematic, detail-oriented. Expression through typography and spacing, not color. Restrained palette, nothing generic.

---

## Chat Drawer

- **Position:** Right panel, slides in from right edge
- **Width:** Fixed 380px
- **Default state:** Collapsed on `/dashboard`, `/settings`. Auto-open on `/onboarding`, `/apply/:id`
- **Context:** Per-page. Knows which evaluation/page the user is on.
- **History:** Persistent within session on current page. Navigating away clears it.
- **Mobile:** Becomes full-screen overlay

---

## Onboarding Flow

1. User enters invite code + OpenRouter key on `/`
2. Redirected to `/onboarding`
3. Upload CV (PDF/DOCX/MD) via file picker
4. Server extracts text (pdf-parse / mammoth for DOCX)
5. LLM converts raw text to structured `cv.md` using template structure
6. LLM asks clarifying questions if anything is ambiguous (via chat)
7. User answers, LLM refines
8. Short profile form: name, location, target roles, salary range
9. Save `cv.md` + `profile.yml` + `_profile.md` to user's directory
10. Redirect to `/dashboard`

---

## PDF Generation Flow

1. User views evaluation at `/evaluate/:id`
2. Clicks "Generate tailored CV" button (only shown for evaluated offers)
3. Server reads user's `cv.md` + evaluation report
4. LLM performs keyword injection (reframes existing experience with JD vocabulary)
5. Populates `templates/cv-template.html`
6. `generate-pdf.mjs` runs Playwright/Chromium to render PDF
7. PDF saved to `data/users/{id}/output/`
8. Path stored in SQLite `applications.pdf_path`
9. Browser receives download link

---

## Open Tasks

### 1. Harness implementation foundation

**Type:** Implementation
**Description:** Land the orchestrator, split state model, checkpoint persistence, lease ownership, and append-only event log that the browser product will wrap.
**Depends on:** `docs/PRD_BROWSER_HARNESS_V1.md`
**Blocks:** Backend evaluation, extraction/runtime, renderer, tracker sync, and browser routes.

### 2. VPS architecture

**Type:** Question/decision session
**Description:** Pin down the server-side architecture: process management, deployment pipeline, environment config, SSL/domain, monitoring, backup strategy, Playwright resource management, how the browser server routes are structured.
**Depends on:** Harness foundation (partially -- the harness affects server-side code structure).
**Blocks:** Implementation.

### 3. Coding principles

**Type:** Discussion session
**Description:** Establish code principles for this codebase: naming conventions, file organization, error handling philosophy, testing strategy, dependency policy, commit conventions.
**Depends on:** Nothing.
**Blocks:** Nothing (but should be done before significant implementation begins).

### 4. Paper MCP design mockups

**Type:** Design session
**Description:** Design the UI in Paper for all pages: landing/login, onboarding, dashboard/tracker, evaluate, evaluate/:id, apply/:id, settings, chat drawer. Use Fraunces + Commit Mono, ink palette, desktop-first layouts.
**Depends on:** This PRD plus the harness flow.
**Blocks:** Frontend implementation.

---

## Backlog

- Email magic links for long-term session persistence (info banner prompting users)
- Portal scanning (Playwright + ATS APIs + scheduled jobs)
- Batch evaluation (sequential queue first, parallel later)
- Compare offers (dedicated page vs chat drawer -- validate via usage)
- Deep company research (dedicated page vs chat drawer)
- Dark mode
- LinkedIn outreach / contact mode
