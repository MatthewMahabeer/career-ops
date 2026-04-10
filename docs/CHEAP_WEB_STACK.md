# Cheap Web Stack For A Browser-First Career-Ops

This note translates the "SearXNG + Crawl4AI + Firecrawl + MCP" discussion into practical guidance for this project.

The goal is not to recreate Codex or Claude Code in a browser.
The goal is to build a cheap browser product for a small number of users that can:

- discover jobs
- verify job pages
- evaluate fit
- generate PDFs
- update a tracker

## Short Answer

The open-source search and crawling tools do **not** mean "only model credits."

They mean:

- you can avoid paying a hosted search vendor for every query
- you still pay for your own compute, memory, bandwidth, and browser automation
- you only spend model credits when you ask a model to interpret, summarize, rank, or extract with an LLM

For this project, the cheapest serious approach is:

1. Use public ATS APIs first
2. Use a cheap search fallback only when ATS APIs fail
3. Use Playwright or a crawler only for verification and page extraction
4. Spend model credits only on evaluation, summarization, and decision support

## The Four Layers

### 1. Discovery / Search

This layer answers: "what URLs should we inspect?"

Options:

- **ATS APIs**
  - Greenhouse public job board API
  - Ashby public job posting API
  - Lever public postings API
- **SearXNG**
  - self-hosted metasearch
- **Brave / Tavily / Exa**
  - hosted fallback search APIs

Cost profile:

- ATS APIs: effectively free
- SearXNG: no per-query vendor fee, but you pay hosting and maintenance
- Brave / Tavily / Exa: low hosted cost, usually much cheaper than Firecrawl for search-only use

### 2. Crawl / Render / Fetch

This layer answers: "what is actually on the page?"

Options:

- **Playwright**
- **Crawl4AI**
- **Crawlee**
- **self-hosted Firecrawl**

Cost profile:

- no model credits by default
- you pay compute and browser runtime
- at scale you may also pay for proxies or anti-bot infrastructure

### 3. Extraction / Structuring

This layer answers: "turn the page into data the system can reason over."

Two modes:

- **Rule-based extraction**
  - CSS selectors
  - XPath
  - regex
  - known ATS schemas
- **LLM-based extraction**
  - summarize the role
  - infer company, level, comp hints, remote policy
  - normalize messy pages

Cost profile:

- rule-based extraction: no model credits
- LLM-based extraction: model credits

This is where many teams accidentally overpay. If a page is already structured, do not run an LLM just to restate obvious fields.

### 4. Domain Reasoning

This layer answers: "is this role a good fit for this candidate?"

This is where model spend actually belongs.

Examples:

- `evaluate_job`
- `compare_offers`
- `generate_summary`
- `draft_application_answer`

Cost profile:

- model credits

This is the high-value use of the model. Search and crawling should stay as dumb and cheap as possible.

## Important Correction To The "Only Model Credits" Idea

If you self-host web tooling, your cost categories become:

- model inference
- server compute
- headless browser compute
- storage / caching
- bandwidth
- optional proxies

So the correct statement is:

> Open-source search and crawling can eliminate or reduce vendor search credits, but they do not make web access free.

## What Each Tool Is Good For

### SearXNG

Use for:

- low-cost broad web discovery
- fallback search when no ATS API exists

Do not use for:

- high-reliability extraction on dynamic pages
- anything that requires rendering or clicking

Tradeoff:

- very cheap
- operationally noisier than a hosted search API

### Crawl4AI

Use for:

- rendering JS-heavy pages
- converting pages to markdown
- structured extraction
- screenshots

Good fit when:

- you want Python tooling
- you want LLM extraction to be optional, not mandatory

### Crawlee

Use for:

- browser automation in a TypeScript stack
- large crawls
- more advanced retry/session/proxy handling

Good fit when:

- the main product stack is Node.js / TypeScript

### Firecrawl (Self-Hosted)

Use for:

- an all-in-one crawl/search/extract system if you are willing to self-host it

Important:

- it is open source
- that does **not** mean zero cost
- you still own the infrastructure and operational overhead

### Hosted Search APIs: Tavily / Brave / Exa

Use for:

- cheap fallback search before you build or maintain your own SearXNG deployment

These can be a better fit than Firecrawl when:

- you only need discovery, not full scrape workflows
- this is a pet project and you want minimal maintenance

## The Best Cheap Architecture For This Repo

Do **not** give the model generic low-level tools like:

- `search_web`
- `scrape_any_page`
- `click_random_links`

Instead, wrap the web layer behind domain tools.

Recommended tool surface:

- `scan_portals`
- `verify_job_page`
- `evaluate_job`
- `generate_pdf`
- `update_tracker`

### `scan_portals`

Implementation priority:

1. Read from configured ATS/company sources
2. Hit public ATS APIs directly where possible
3. Use cheap search fallback for missing companies
4. Cache everything aggressively

Ideal stack:

- Greenhouse API
- Ashby API
- Lever API
- Tavily or Brave fallback
- optional SearXNG later

### `verify_job_page`

Implementation priority:

1. Load the actual job page
2. Confirm the description exists
3. Confirm the apply action exists
4. Return normalized page data

Ideal stack:

- Playwright first
- Crawl4AI or Crawlee if you want a richer extraction layer

### `evaluate_job`

Implementation priority:

1. Take normalized job data
2. Compare against CV and profile
3. Score and explain fit
4. Produce the report

Ideal stack:

- model only here

### `generate_pdf`

Implementation priority:

1. Use existing templates
2. Use existing repo scripts
3. Keep this deterministic

Ideal stack:

- existing `generate-pdf.mjs`
- Playwright for rendering

### `update_tracker`

Implementation priority:

1. write canonical structured data
2. preserve pipeline integrity

Ideal stack:

- existing repo merge / verify scripts

## Cheapest Realistic Starting Stack

If the goal is "good enough for me and a few friends," start here:

- **Discovery**
  - Greenhouse / Ashby / Lever direct
  - Tavily free tier as fallback
- **Verification**
  - Playwright
- **Extraction**
  - rule-based first
  - only use an LLM when the page is messy
- **Reasoning**
  - OpenRouter model of choice
- **Persistence**
  - existing repo files at first

This will usually be much cheaper than:

- Firecrawl as the primary search layer
- a full general-purpose browser agent loop

## When To Add SearXNG

Add SearXNG only if:

- fallback search volume becomes meaningful
- hosted search costs become annoying
- you are willing to maintain the service

Do **not** start with SearXNG unless you actually want to own that infrastructure.

## When To Add Crawl4AI Or Crawlee

Add one of these when:

- Playwright-only extraction becomes too manual
- you need reusable page-to-markdown conversion
- you want a cleaner crawling layer for the browser product

Rule of thumb:

- choose **Crawlee** if the app stack is primarily TypeScript
- choose **Crawl4AI** if you want a strong Python crawler with optional LLM extraction

## What Not To Build

Avoid these traps:

- a browser clone of Codex / Claude Code for end users
- fully general web-browsing agents for a narrow domain workflow
- using an LLM for every page extraction step
- paying Firecrawl or another premium vendor for simple search discovery

For this product, the domain is narrow enough that a custom orchestrator is better than a generic coding agent.

## Recommended Direction

For a browser-first Career-Ops product:

1. Keep the existing repo as the domain engine
2. Expose narrow backend tools, not generic shell tools
3. Prefer ATS APIs over web search
4. Use Playwright for verification
5. Use cheap hosted search only as fallback
6. Spend model credits on fit evaluation and user-facing reasoning

That gives you the best chance of staying close to free while still being useful.
