# Raffy Research

Raffy Research is a market-intelligence pipeline with a web app on top. It continuously acquires raw market evidence from external data providers, normalizes everything into auditable **source records**, and synthesizes a weekly intelligence report per workspace using an LLM. An analyst works the data: reading reports, tracing claims back to sources, labeling which sources were worth keeping, and scoring each report on a rubric — so the pipeline's quality is **measured**, not assumed.

The product thesis in one sentence: **a quality pipeline for acquiring information and synthesizing evidence, operated by an analyst.** Everything in this repository serves one loop:

```
steer (topics/questions) → ingest (providers) → assess evidence → read synthesis → judge quality → the system improves
```

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Operator Guide](#operator-guide)
3. [Technical Details](#technical-details)
4. [Evals: The Quality Loop](#evals-the-quality-loop)
5. [Split-Brain Mode](#split-brain-mode)
6. [Development Reference](#development-reference)

---

## High-Level Overview

### What the system does

```mermaid
flowchart LR
    subgraph Acquire
        P[11 data providers<br/>Apify · Exa · Semrush · Ahrefs<br/>Awario · Trigify · ForumScout<br/>Visualping · Distill · Notion · Slack]
        CB[Provider callbacks<br/>POST /api/providers/:provider/callback]
        CRON[Cron ingest<br/>POST /api/cron/daily-ingest]
    end
    subgraph Evidence
        SR[(sourceRecord<br/>permanent, append-only)]
        SS[(sourceSummary<br/>per-source LLM summaries)]
        LBL[Analyst keep/junk labels]
    end
    subgraph Synthesize
        GEN[generateWeeklyReport<br/>prompt → LLM → validate → repair → freeze]
        WR[(weeklyReport<br/>frozen, versioned)]
        LINKS[(weeklyReportSource<br/>cited / relevant-unused links)]
    end
    subgraph Judge
        RUB[(reportRubricScore<br/>relevance · accuracy · novelty)]
        EVAL[LLM-judge eval<br/>quality lab only]
    end

    P --> CB --> SR
    CRON --> SR
    SR --> SS
    SR --> GEN
    SS --> GEN
    LBL -- junk excluded --> GEN
    GEN --> WR --> LINKS
    WR --> RUB
    WR --> EVAL
    RUB -. informs next iteration .-> GEN
    EVAL -. informs next iteration .-> GEN
```

* **Acquisition.** External providers push results through authenticated webhook callbacks; scheduled cron jobs trigger pull-based ingestion. Every payload is normalized into a `sourceRecord` — duplicates intentionally allowed, raw payloads preserved for audit.
* **Synthesis.** Once a week (or on demand), the system gathers a workspace's period sources, configured keywords/competitors/social accounts, prior reports, and optional per-source summaries, builds a versioned prompt, and generates a structured JSON report. Output is schema-validated with a single bounded repair pass; published reports are frozen and append-versioned.
* **Judgment.** The analyst scores each report on a three-dimension rubric, labels sources keep/junk (junk is excluded from future generation), and can run an adversarial LLM judge in the local quality lab that checks every report claim against the underlying sources.

### Who uses it

| Role | Surface | What they do |
|---|---|---|
| Analyst | `/app` | Reads the latest report, traces evidence to sources, labels sources keep/junk, scores reports on the rubric |
| Manager/admin | `/manager` | Manages users and workspaces, inspects provider callbacks and report history |
| Operator (you) | Dev AI console + evidence mode | Iterates on the pipeline locally against production data using subscription-billed local agents (see [Split-Brain Mode](#split-brain-mode)) |

### The five modules

| Module | Purpose |
|---|---|
| `intelligence` | The product: sources, reports, rubric scores, providers, generation, ingestion, local AI lab |
| `auth` | Better Auth email/password sessions, roles, permission checks |
| `user` | User administration (list/create/update/revoke) |
| `account` | Self-service account settings |
| `kernel` | Cross-cutting: branded IDs, `AppError`/`Result` outcomes, Drizzle DB layer, OTel observability, runtime config |

---

## Operator Guide

### First-time setup (local, isolated)

```bash
cp .env.example .env  # Set env variables
pnpm install          # Install dependencies
pnpm dk:init          # Start Docker containers (PostgreSQL, MinIO)
pnpm db:init          # Push the Drizzle schema and seed the database
pnpm dev              # Run the app
```

The seed creates one workspace with a published example report. Sign in at `/login` (signup is disabled by design; use `pnpm auth:set-credential` to set a password for a seeded user).

### Day-to-day analyst workflow

1. **Read the report.** `/app` shows the workspace's latest published report: executive summary, "what looks most interesting," contradictions, topic clusters, competitor watch, market questions, possible leads, social/product feedback, and the source library.
2. **Trace claims.** Every evidence row has an *Open source* button; the Source Library lists every linked source with a `Cited` / `Relevant` badge. The source sheet shows content, diffs (added/removed text for monitored pages), and the internal source reference.
3. **Label sources.** In any source view, answer *"Is this source worth keeping?"* with **Keep** or **Junk** (clicking again clears the label). Junk-labeled sources are excluded from all future report generation for that workspace and the exclusion count is logged per run.
4. **Score the report.** At the bottom of every report, the **Score this report** panel asks for 1–5 on three dimensions, plus an optional note:
   * **Relevance** — does this report cover what matters to us this week?
   * **Accuracy** — are the claims faithful to the underlying sources?
   * **Novelty** — did it tell us something we did not already know?

   One score per report per user; re-scoring replaces your previous score, and the row history accumulates one judgment per report so quality can be tracked over time.

### Manager workflow

* `/manager/workspaces` → workspace detail shows company config, keywords, competitors (with suggested/accepted state), provider configs, internal note configs, report history with status badges, and the raw provider callback log.
* `/manager/users` handles user administration.
* In development builds, the workspace page also shows the **Local AI console** (see below).

### Dev AI console (development only)

On `/manager/workspaces/:id` when `DEV` is true. Controls:

| Control | Effect |
|---|---|
| Week date | Anchor date; the system computes the workspace-timezone Monday–Sunday period |
| Provider | `codex-cli` or `claude-code` |
| Model | Optional override; empty uses the `LOCAL_AI_MODEL` env default |
| **Load sources** | Lists the period's source records and selects them all |
| **Ingest enabled** | Runs all enabled provider ingestion for the workspace |
| **Reprocess callbacks** | Re-runs normalization for selected raw callbacks |
| **Summarize sources** | One LLM call per selected source → stored `sourceSummary` rows |
| **Generate report** | Full generation against the selected sources |
| **Evaluate report** | LLM-judge pass over the latest published report ([details](#signal-3--the-llm-judge-evaluate_report)) |
| **Full workflow** | Ingest → reprocess → summarize → generate in one run |
| **Stop** | Aborts the in-flight run (the abort reason is preserved end-to-end) |

Every run streams NDJSON events into the run log, and every model call writes its raw output to `.local-ai-runs/` (gitignored) for post-hoc inspection.

### Scheduled production jobs

| Endpoint | Schedule intent | Auth |
|---|---|---|
| `POST /api/cron/daily-ingest` | Daily provider ingestion | `CRON_SECRET`, constant-time comparison, checked before body parsing |
| `POST /api/cron/weekly-reports` | Weekly report generation for every workspace | same |
| `POST /api/providers/:provider/callback` | Provider webhooks, any time | `PROVIDER_WEBHOOK_SECRET`, constant-time, no body persistence before auth |

### Database migrations

```bash
pnpm db:generate          # Generate a migration from schema changes
pnpm db:migrate           # Apply migrations (local/dev)
pnpm db:migrate:evidence  # Apply against the production Neon DB (requires DATABASE_MIGRATION_URL in .env.ai.local)
pnpm check:migrations     # Guard: committed migrations must not be edited
```

Never use `db:push` against production — it bypasses migration history.

---

## Technical Details

### Architecture

Strict hexagonal monolith. Cross-module imports go **only** through public gates (`index.ts`, `server.ts`, `backend.ts`, `client.ts`, `presentation.ts`, test-only `testing.ts`); architecture tests enforce this, and the layer rules below, in CI:

| Layer | May use | Must not use |
|---|---|---|
| `domain` | Pure TS, kernel domain types | React, router, Query, infrastructure, SDKs |
| `application` | Own domain, own ports, kernel ports | Infrastructure, transport, React |
| `infrastructure` | Own ports/domain, kernel, SDKs | Other modules' internals |
| `transport` | Protocol mapping + injected use cases | Own infrastructure directly, composition |
| `presentation` | React, queries, platform UI | Own infrastructure directly |

Production wiring lives in `src/composition/*` using `createCachedFactory` (singletons normally, fresh instances when overrides are passed). Failures are typed: use-cases return `Result<Outcome, AppError>` with exhaustive tagged-union outcomes (`report_scored`, `forbidden`, `source_record_not_found`, …) that transport maps to HTTP semantics.

### Data model (intelligence)

| Table | Role |
|---|---|
| `workspace` + `workspaceKeyword` / `workspaceCompetitor` / `workspaceSocialAccount` | What to watch, per customer |
| `providerConfig`, `internalNoteConfig` | Which providers/notes feed the workspace |
| `providerCallbackEvent` | Raw webhook payloads + normalization status (audit trail) |
| `sourceRecord` | Permanent captured evidence; includes `relevanceLabel` (`keep`/`junk`/null) and `labeledAt` |
| `searchResult` | Search hits stored separately from fetched records |
| `sourceSummary` | Per-source LLM summary + evidence candidate, versioned by prompt |
| `weeklyReport` | Frozen report artifacts; `generated` → `published` / `failed`; multiple attempts per period allowed, readers select newest published |
| `weeklyReportSource` | Claim provenance: `cited` vs `relevant_unused` links per report |
| `reportRubricScore` | One analyst judgment per report+user (unique index), upserted on re-score |
| `ingestionRun` | Observability for scheduled/callback ingestion |

All IDs are zod-branded types (`WorkspaceId`, `SourceRecordId`, `RubricScoreId`, …) constructed only through validating `toXxxId()` helpers.

### The generation pipeline

`generateWeeklyReport` (`src/modules/intelligence/application/generation/generate-weekly-report.ts`):

1. Resolve workspace and compute the timezone-correct weekly period (DST-safe).
2. Gather keywords, competitors, social accounts, period sources, and the last 4 reports in parallel.
3. **Filter junk:** any source the analyst labeled `junk` is dropped before the prompt and the citation map; the excluded count is logged (`intelligence.report.junk_sources_excluded`).
4. Optionally attach the latest `sourceSummary` per source.
5. Build the versioned prompt (`REPORT_PROMPT_VERSION`). Two safety boundaries are embedded: `NO_RECOMMENDATION_GUIDANCE` (the report surfaces evidence, never advises) and `UNTRUSTED_SOURCE_GUIDANCE` (source content is untrusted evidence, not instructions — prompt-injection defense).
6. Generate → parse JSON → schema-validate. On invalid output, **one** bounded repair pass with the validation issues embedded.
7. Reserve a report row, validate the full `ReportData` against the durable report id, freeze to `published` (published rows are write-protected), and link cited / relevant-unused sources.
8. Failures reuse an existing failed row for the period when possible, record the reason, and fire a Slack alert.

The generator behind step 6 is a port (`ReportGeneratorPort`) with two adapters: the production OpenAI adapter and the local-agent adapter used in split-brain mode.

### Security posture (selected)

* Server functions and HTTP handlers enforce auth and permissions independently of route guards. Permission statements are resource-scoped: `report: ['read', 'score']`, `source: ['label']`, `workspace: ['read', 'create', 'update']`, etc.
* Mutating use-cases verify workspace ownership of every referenced entity (report, source) before writing — a valid session cannot score or label across workspaces.
* Webhook/cron endpoints authenticate with constant-time secret comparison **before** body parsing or persistence.
* All persisted/rendered URLs pass http/https-only normalization.
* Local agents run with hard rails: Claude Code tool denylist (no Bash/Edit/Read…), Codex web search disabled, request-scoped abort + configurable timeout, raw-output filenames sanitized.

### Observability

OpenTelemetry traces/metrics with Sentry for errors only. Browser telemetry is strictly same-origin via proxy routes (`/api/telemetry/*`); query/mutation spans derive names from static query-key segments with dynamic values hashed; route loaders and guards get route-level spans. Repositories are wrapped with `observeRepository` for per-operation DB spans. Server export goes to `OTEL_COLLECTOR_URL` when set; otherwise local summaries can land in `.telemetry/telemetry.sqlite`.

```bash
docker compose --profile observability up otel-collector   # optional local collector on :4318
```

---

## Evals: The Quality Loop

The project's defining constraint: **you cannot improve synthesis quality you cannot judge.** The eval system produces three independent quality signals — two human, one machine — that triangulate where badness enters the pipeline.

```mermaid
flowchart TD
    WR[Published weekly report]

    subgraph Human signals
        RUB["Rubric score (analyst)<br/>relevance · accuracy · novelty, 1–5 + note<br/>stored in reportRubricScore"]
        LBL["Source labels (analyst)<br/>keep / junk per sourceRecord"]
    end

    subgraph Machine signal
        JUDGE["LLM judge (quality lab)<br/>claim_support · coverage · noise, 1–5<br/>violations + missed signals"]
    end

    WR --> RUB
    WR --> JUDGE
    SR[(sourceRecord)] --> LBL
    SR --> JUDGE

    RUB -->|trend per report over time| DIAG{Where does quality break?}
    LBL -->|junk ratio per provider| DIAG
    JUDGE -->|unsupported claims, missed signals| DIAG

    DIAG -->|acquisition is weak| FIX1[Tune providers / keywords]
    DIAG -->|synthesis is weak| FIX2[Iterate prompt in the lab]
    DIAG -->|noise is high| FIX3[Label more junk → auto-excluded]

    FIX1 -.-> SR
    FIX2 -.-> WR
    FIX3 -.-> LBL
```

### Signal 1 — Analyst rubric scores

* **Where:** the panel at the bottom of every report page.
* **What:** three integer scores 1–5 (validated in domain *and* transport) plus an optional ≤2000-char note.
* **Semantics:** upsert keyed on `(reportId, userId)` — your latest judgment wins, and the table accumulates exactly one row per report per scorer, which makes week-over-week trend queries trivial.
* **Chain:** `RubricScorePanel` → `intelligenceScoreReport` server fn → `scoreReport` use-case (permission `report: ['score']`, workspace-ownership check) → `RubricScoreRepository.upsert` (`onConflictDoUpdate`).
* **Why these dimensions:** *relevance* isolates steering/acquisition failures, *accuracy* isolates synthesis hallucination, *novelty* isolates stale-source and repetition failures. A report can score 5/5/1 — that pattern tells you exactly what to fix.

### Signal 2 — Source keep/junk labels

* **Where:** every source detail view (report source sheet and source page).
* **What:** `keep`, `junk`, or unlabeled (`null`); toggling the active label clears it. `labeledAt` records when.
* **Effect:** junk is **actively excluded** from generation input — the label is not just measurement, it immediately improves the next report's signal-to-noise. Exclusions are logged per generation run.
* **Measurement use:** junk-rate per provider over time is the canonical acquisition-quality metric (e.g. "ForumScout is 70% junk; Visualping is 5%").

### Signal 3 — The LLM judge (`evaluate_report`)

An adversarial machine evaluation that runs **only in the quality lab** (the dev console). Nothing it produces is persisted to the database — verdicts stream to the console and are captured in `.local-ai-runs/` raw output files. This is deliberate: the judge is an iteration instrument, not a production feature.

```mermaid
sequenceDiagram
    actor Op as Operator
    participant UI as Dev AI console
    participant H as local-ai-stream-handler<br/>(POST /api/dev/intelligence/local-ai/stream)
    participant DB as Neon / Postgres
    participant J as Local agent<br/>(Codex CLI, Claude Code, or Ollama)
    participant FS as .local-ai-runs/

    Op->>UI: click "Evaluate report"
    UI->>H: { action: "evaluate_report", workspaceId, provider, model }
    H->>H: dev check · session auth · workspace access
    H-->>UI: NDJSON start event
    H->>DB: getLatestPublished(workspaceId)
    DB-->>H: weeklyReport (or 404 LOCAL_AI_NO_PUBLISHED_REPORT)
    H->>DB: listForPeriod(report.periodStart … periodEnd)
    DB-->>H: period sourceRecords (incl. analyst labels)
    H-->>UI: step: report_evaluation_started {reportId, sources}
    H->>J: buildEvalPrompt(report JSON + rendered sources)
    J-->>H: streamed text deltas + tool events
    H-->>UI: tool_event / step events (live)
    J-->>FS: raw output JSON written per run
    H->>H: extractJsonObject(verdict)
    H-->>UI: artifact: report_evaluation {scores, violations, missed_signals}
    H-->>UI: done {reportId, parsedVerdict}
```

**The judge prompt** (`build-eval-prompt.ts`, version `report-eval-v1`) instructs the model to act as an adversarial evaluator, judge only what is verifiable from the provided source records, and explicitly not reward fluent writing. It embeds the same `UNTRUSTED_SOURCE_GUIDANCE` boundary as generation. Required output shape:

```json
{
  "scores": { "claim_support": 1, "coverage": 1, "noise": 1 },
  "violations": [
    { "section": "...", "claim": "...",
      "problem": "unsupported | misattributed | contradicted | irrelevant",
      "source_ids": ["..."] }
  ],
  "missed_signals": [ { "source_id": "...", "why_it_matters": "..." } ],
  "summary": "..."
}
```

* **claim_support** — every factual claim in the report is traceable to at least one source record. Catches hallucination and misattribution.
* **coverage** — important signals present in the sources made it into the report. Catches "misses what matters" (it sees *all* period sources, including ones the report ignored).
* **noise** — the report avoids padding with irrelevant items (5 = no noise).

The judge sees analyst labels (`analyst_label: keep/junk`) on each rendered source, so human judgment contextualizes machine judgment. Source content is truncated (4000 chars content, 1500 diff-added) to bound prompt size.

### How the three signals compose

| Symptom | Rubric | Labels | Judge | Likely fix |
|---|---|---|---|---|
| Hallucinated claims | accuracy ↓ | — | claim_support ↓, violations list the claims | Prompt/model iteration in the lab |
| Important events missing | novelty/relevance ↓ | — | coverage ↓, missed_signals name the sources | Prompt iteration; check summaries |
| Report full of filler | relevance ↓ | junk rate ↑ | noise ↓ | Label junk (auto-excluded), prune providers |
| Garbage in, garbage out | accuracy ↔ | junk rate ↑ for one provider | violations cite that provider's sources | Fix or disable the provider |

The intended iteration cadence: change one thing (prompt, provider config, source selection) → regenerate in the lab → run `evaluate_report` → compare verdicts (raw outputs in `.local-ai-runs/` diff cleanly) → ship the change → confirm with the analyst's rubric score on the next real weekly report.

### Eval cases (Arize Phoenix experiments)

Experiments read **eval cases** — git-stored snapshots under `fixtures/eval/<name>/` — not the live database. A case pins everything the report prompt consumes, so an experiment run today is comparable with one run months ago even as the database moves on:

```text
fixtures/eval/<name>/
  case.json           # identity, pinned report id, period, Phoenix binding
  workspace.json      # workspace + keywords + competitors + social accounts
  sources.json        # the period's source records
  report.json         # the reference report (the expected output)
  prior-reports.json  # the prior reports that were in the prompt's context
```

Mint one from the database, pinning a specific report:

```bash
pnpm eval:phoenix export --workspace <id> --report <id> --name acme-2026-06-15 \
  --out fixtures/eval/acme-2026-06-15
```

Then run experiments against it. With `--case`, no database is touched at all:

```bash
pnpm eval:phoenix compare --workspace <id> --case fixtures/eval/acme-2026-06-15
```

**One case, one Phoenix dataset, for life.** `case.json` records the `datasetId` the case was first pushed under, plus a content hash of the pushed example. On each run:

| Case state | What happens |
|---|---|
| Hash matches the remote dataset | Reused as-is, nothing written |
| Case content changed | A new dataset *version* is appended under the case's stable example id — same dataset |
| Dataset missing from Phoenix | A new one is created and re-pinned |
| Dataset exists under the case name but is unpinned | Adopted, and its id recorded |

Because the id lives in git, a teammate's run and a run three months from now land on the same Phoenix dataset. Experiments pin the exact `versionId` they used, so a chart of runs compares like with like.

Two guardrails: `export` is the only command that reads live data on purpose, and `--case` is refused for `generate`/`full`, because those publish a report and would move the very baseline the case exists to pin.

---

## Split-Brain Mode

Split-brain mode runs **two brains against one production dataset**:

* the **cloud brain** — the deployed Vercel app serving real users, generating production reports through the metered OpenAI API, ingesting via cron and webhooks;
* the **local brain** — your development machine running the same codebase against the *same* production Neon database, but doing all AI work through **local providers (Codex CLI, Claude Code, or a self-hosted Ollama model)** that are billed by your existing flat-rate subscriptions, or by nothing at all, rather than per token.

The name is deliberate: the two brains share one memory (the database) but think independently. Provider webhooks and user traffic keep hitting the cloud brain; expensive, exploratory AI work happens on the local brain at zero marginal cost.

```mermaid
flowchart TB
    subgraph CLOUD["☁️ Cloud brain (Vercel)"]
        APP[Production app]
        OAI[OpenAI API generator<br/>metered $/token]
        CRONJ[Cron: daily ingest,<br/>weekly reports]
    end

    subgraph SHARED["Shared memory"]
        NEON[(Neon Postgres<br/>sourceRecord · weeklyReport ·<br/>sourceSummary · rubric scores)]
    end

    subgraph LOCAL["💻 Local brain (your machine, pnpm dev:evidence)"]
        DEVAPP[Same app, dev mode]
        CONSOLE[Dev AI console]
        STREAM[NDJSON stream handler]
        AGENTS[Codex CLI / Claude Code / Ollama<br/>subscription-billed or self-hosted, $0 marginal]
        RAW[.local-ai-runs/ raw outputs]
    end

    USERS[Analyst & users] --> APP
    PROVIDERS[Provider webhooks] --> APP
    APP <--> NEON
    CRONJ --> OAI --> NEON

    DEVAPP <--> NEON
    CONSOLE --> STREAM --> AGENTS
    AGENTS --> RAW
    STREAM <--> NEON
```

### Why it exists

Iterating on synthesis quality is token-hungry. A single full-workflow run (summarize ~50 sources + generate + evaluate) consumes hundreds of thousands of tokens, and meaningful prompt iteration means *dozens* of runs per week. Paying API rates for exploration both burns money and — worse — creates pressure to iterate less. Split-brain mode removes the marginal cost of experimentation entirely while keeping production generation on the predictable, low-volume API path.

### Environment layering

Evidence mode is plain dotenv layering, loaded by `dotenv-cli`:

```
.env  →  .env.local (pulled from Vercel production)  →  .env.ai.local (your overrides)
```

> [!IMPORTANT]
> `dotenv-cli` keeps the **first** value it sees for a key, so the file listed first on
> the command line wins. The evidence scripts list `-e .env -e .env.local -e .env.ai.local`,
> which means `.env.ai.local` can only *add* keys that the earlier files leave undefined —
> it cannot override one they already set.
>
> This matters most for `DATABASE_DRIVER`, which `.env` defines as `node-pg`: setting
> `DATABASE_DRIVER="neon-http"` in `.env.ai.local` has no effect, and the run silently
> stays on local Docker Postgres instead of production Neon. `LOCAL_AI_*`, `OLLAMA_BASE_URL`
> and `PHOENIX_*` are unaffected, because `.env` does not define them.
>
> To override a key the earlier layers already set, either edit it in the file that owns it
> or reorder the `-e` flags so the override layer comes first.

`.env.ai.example` documents the override file:

```bash
VITE_BASE_URL="http://localhost:${VITE_PORT}"   # local app URL for dev-only AI tools
DATABASE_DRIVER="neon-http"                     # same Neon DB as the Vercel runtime
# DATABASE_MIGRATION_URL="postgres://..."       # required for db:migrate:evidence
# DATABASE_MIGRATION_DRIVER="neon-websocket"
LOCAL_AI_PROVIDER="codex-cli"                   # codex-cli | claude-code | ollama
LOCAL_AI_MODEL="gpt-5-codex"
LOCAL_AI_RAW_OUTPUT_DIR=".local-ai-runs"
LOCAL_AI_TIMEOUT_MS=600000
# OLLAMA_BASE_URL="http://localhost:11434/api"  # only when LOCAL_AI_PROVIDER="ollama"
```

### Operator setup

```bash
# 1. Pull production env from Vercel into .env.local
pnpm env:pull:production

# 2. Create your local override layer
cp .env.ai.example .env.ai.local        # then edit as needed

# 3. Make sure your agent CLI is authenticated (subscription login)
codex login            # or: claude login

# 4. (only when migrations are pending) apply them to Neon
pnpm db:migrate:evidence

# 5. Run the local brain
pnpm dev:evidence

# 6. (if needed) set a password for your production user
pnpm auth:set-credential
```

Then open `/manager/workspaces/:id` — the Local AI console appears because the app is in dev mode — and drive any action against real production evidence.

### What a local run looks like

```mermaid
sequenceDiagram
    actor Op as Operator
    participant C as Console (browser)
    participant S as Stream handler (local server)
    participant A as Agent CLI subprocess
    participant N as Neon (production data)

    Op->>C: select week, provider, sources → "Full workflow"
    C->>S: POST /api/dev/intelligence/local-ai/stream
    Note over S: isDev() gate → 404 in prod builds<br/>session auth → workspace access check
    S-->>C: start {runId, provider, model}
    S->>N: ingest enabled providers
    S-->>C: artifact: workspace_ingest
    loop each selected source
        S->>A: summary prompt (untrusted-source guarded)
        A-->>S: streamed deltas
        S->>N: insert sourceSummary
        S-->>C: artifact: source_summary
    end
    S->>A: report prompt (junk-labeled sources pre-filtered)
    A-->>S: report JSON (validate → bounded repair pass)
    S->>N: freeze published weeklyReport + source links
    S-->>C: artifact: weekly_report → done
    Note over Op,C: Stop button aborts: AbortController →<br/>agent subprocess killed, LOCAL_AI_RUN_ABORTED preserved
```

Every model call writes a raw-output JSON file under `.local-ai-runs/` (request metadata, full event stream, final text), named by run id and sanitized label — the audit trail for comparing iterations.

### Safety rails on the local brain

| Rail | Detail |
|---|---|
| Dev-only endpoint | The stream handler returns 404 unless `DEV`; the route never ships usable in production |
| Full auth anyway | Session + workspace access are checked even in dev, before any body-driven work |
| Agent tool denylist | Claude Code runs with Bash/Edit/Read/etc. disabled — the agent is a text generator, not an actor |
| No web search | Codex web search is disabled for report generation; evidence comes only from the database |
| Timeout + abort | `LOCAL_AI_TIMEOUT_MS` (default 10 min) hard-aborts; client disconnect and the Stop button abort too; abort errors keep their `AppError` codes |
| Prompt-injection guard | All source content is wrapped in `UNTRUSTED_SOURCE_GUIDANCE` — sources are evidence, never instructions |
| Write protection | Published reports are frozen; `replaceContent` refuses to overwrite a published row |

### Cost-reduction expectations

The economics, with explicitly labeled assumptions. Assume a realistic iteration week: a workspace with ~50 period sources, per-source summaries (~3k tokens in / 300 out each), report generation (~120k tokens in / 8k out per attempt), and judge evals (~130k in / 4k out), at an illustrative blended frontier-model API price of $1.25/M input and $10/M output tokens.

| Activity | Tokens per run (approx.) | API cost per run | Runs per iteration week | API cost per week |
|---|---|---|---|---|
| Summarize 50 sources | 150k in / 15k out | ~$0.34 | 10 | ~$3.40 |
| Generate report | 120k in / 8k out | ~$0.23 | 25 | ~$5.75 |
| Evaluate report (judge) | 130k in / 4k out | ~$0.20 | 25 | ~$5.00 |
| Full workflow | ~400k in / 27k out | ~$0.77 | 10 | ~$7.70 |
| **Iteration total** | | | **70 runs** | **~$22/week (~$95/month)** |

On the local brain, every one of those runs bills against a Codex / Claude Code subscription you already pay for as a development tool — **the marginal cost of an iteration run is $0**, and the subscription's fixed cost is already sunk in the engineering budget.

Expected outcomes:

* **~100% marginal-cost reduction on iteration.** All exploratory summarize/generate/evaluate work moves off the metered API. At the modeled volume that is roughly **$95/month avoided per actively-tuned workspace**; heavier iteration (more sources, more runs, larger models) scales the avoided cost linearly while local cost stays flat.
* **Production spend becomes small and flat.** The cloud brain only pays for real weekly runs — ~4–5 generations per workspace per month, on the order of **$1–2/month per workspace** at the assumed prices.
* **The real win is behavioral.** Zero marginal cost removes the disincentive to run the judge after *every* change. Eval frequency, not eval cost, is what compounds into report quality.
* **Caveats.** Subscription plans have usage ceilings — very heavy weeks can hit provider rate limits; local runs are bounded by `LOCAL_AI_TIMEOUT_MS` and your machine being awake; and API prices change — treat the dollar figures as a planning model, not a quote. Re-derive with your actual source counts and current prices before budgeting.

---

## Development Reference

### Stack

[Node.js 24](https://nodejs.org) · [TypeScript](https://www.typescriptlang.org/) · [React](https://react.dev/) · [TanStack Start](https://tanstack.com/start) (+ Router/Query) · [Tailwind CSS](https://tailwindcss.com/) · [shadcn/ui](https://ui.shadcn.com/) · [Drizzle ORM](https://orm.drizzle.team/) on [Neon](https://neon.tech) Postgres · [Better Auth](https://www.better-auth.com/) · [Vitest](https://vitest.dev/) · [Playwright](https://playwright.dev/) · [ai-sdk](https://sdk.vercel.ai/) with `ai-sdk-provider-codex-cli` and `ai-sdk-provider-claude-code`

Built on the [Start UI [web]](https://docs.web.start-ui.com) starter by [BearStudio](https://www.bearstudio.fr/team); its conventions (and `AGENTS.md`) remain the authoritative architecture reference.

### Requirements

* Node.js 24.x, pnpm, Docker (or a PostgreSQL database)

### TanStack SSR compatibility

The tested compatibility set is `@tanstack/react-start@1.168.54`,
`@tanstack/react-router@1.170.36`,
`@tanstack/react-router-ssr-query@1.167.2`, and
`@tanstack/react-query@5.102.8`. Query Core is pinned to `5.102.8`, Router
Core to `1.171.30`, and SSR Query Core resolves to `1.169.2`;
`@tanstack/start-client-core@1.170.30` matches Start's requirement.
The core pins keep peer dependencies on the same versions. Do not override Router Core independently:
`pnpm check:ssr-compatibility` checks the versions required by Start and Router.

Two SSR failure modes make a successful build insufficient evidence for an upgrade:

* **Query stream hang:** [TanStack Router issue #7529](https://github.com/TanStack/router/issues/7529) describes Router Core and SSR Query combinations where a fast path skips the query-stream close listener. The page may paint while `curl` or a bot waits until the serialization timeout. The `1.171.32` fast path also moved from `reserveStreamFastPath` to `hydrationScripts.reserveFastPath`, breaking this repo's stream fixture; the pinned `1.171.30` set retains the tested contract.
* **Reload hydration race:** a pending hydration promise from an old WebKit document can signal completion on its replacement after a hard reload. The local `start-hydration-compat` shim binds completion to the original document; `UPSTREAM_TANSTACK_HYDRATION.md` contains the upstream reproduction and proposed fix.

Before changing this set, run `pnpm check:ssr-compatibility`, the SSR lifecycle
integration tests, and `pnpm test:e2e:ssr`. The SSR gate must consume complete
login and authenticated responses without a serialization timeout, then exercise
hydration and reloads in Chromium, Firefox, and WebKit.

Start's response stream owns SSR cleanup. Request middleware preserves the
original response body; replacing it with a transformed body can dispose the
underlying stream before serialization completes. Script nonces are supplied
during rendering through the router and theme provider. Production CSP allows
inline style elements with `style-src-elem 'self' 'unsafe-inline'`; scripts still
require a nonce. Base UI's scrollbar CSS remains in the external app stylesheet.
The browser entry disables Zod JIT
probing so Firefox can validate forms without triggering unsafe-eval violations.
Client hydration also retains the original document and bootstrap state while
route chunks load. Completion after a hard reload must not clear the replacement
document's state through a reused WebKit window. The core hydration API and the
isolated `start-hydration-compat` shim check ownership before signaling
completion. An upstream repro and public API proposal are in
`UPSTREAM_TANSTACK_HYDRATION.md`.

Sentry `11.0.0` reports errors only. The server entry observes stream failures
and preserves SDK serverless flushing without the fetch wrapper that injects
trace metadata into HTML. OpenTelemetry remains the sole owner of tracing.
The Sentry Vite plugin runs only with a browser DSN and upload credentials;
middleware auto-instrumentation and plugin telemetry are disabled. Runtime
Sentry error capture and local SSR tests work without upload credentials.

Run `pnpm test:e2e:ssr` for the complete production regression gate. It runs
`pnpm build:e2e:ssr`, then `pnpm test:e2e:ssr:built`. CI runs those stages
separately: the build has a ten-minute budget; database initialization and server
readiness have two minutes. Both use the same generated fixture manifest under
`.ssr-fixture/`, an explicit environment, and an empty Vite env
directory. Developer `.env` files and application credentials are not inherited.
The manifest is written after a successful build and includes a digest of the
`.output` files; built-only tests reject a stale or overwritten build.
The fixture reserves local ports 3011 (app), 54331 (database), and 43191 (receiver).

Desktop/mobile Chromium, Firefox, and mobile WebKit checks consume complete
login and authenticated SSR responses within ten seconds, exercise sign-in,
compare head metadata and nonces, and check browser proxy authentication and
CSP/hydration errors. A server-only case verifies invalid headers stop startup
before readiness. Integration tests cover immediate and delayed query streams,
cleanup, error propagation, cancellation, and backpressure. Chromium/Firefox
screenshots and failure traces are saved under `test-results/ssr/` for all
three browser engines. This gate is independent of
the Docker-backed E2E matrix. Dependency PRs must pass it before merging.

Sentry's project OTLP integration accepts traces and logs at `/v1/traces` and
`/v1/logs`. The app reads authentication from the standard
`OTEL_EXPORTER_OTLP_HEADERS` format (including percent-encoded values). As of
this setup, the same Sentry integration returns HTTP 404 for `/v1/metrics`, so
native OTLP metrics cannot be treated as delivered until Sentry exposes that
signal for the project. Keep the metrics exporter configured for a compatible
collector, or verify Sentry adds project-level OTLP metrics support before
making it the metrics destination.

Server exporters and the browser proxy resolve headers identically: general
`OTEL_EXPORTER_OTLP_HEADERS`, then the matching
`OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_HEADERS`, then explicit
`OTEL_COLLECTOR_BEARER_TOKEN` authorization. Names are case-insensitive, and
the last entry for a name wins within each variable. The
proxy preserves its validated payload Content-Type. Percent escapes are decoded;
malformed escapes, empty entries, and semicolon metadata fail configuration
validation so credentials cannot disappear silently. Resolved signal headers are
cached for server exporters and browser proxy requests.

For an active collector, invalid decoded HTTP headers, invalid bearer values,
and transport-controlled headers fail build/runtime configuration validation.
The prohibited names are `connection`, `keep-alive`, `proxy-connection`,
`transfer-encoding`, `upgrade`, `expect`, `te`, `trailer`, `host`, and
`content-length`.
Errors identify the variable without exposing credentials. Production requires
a collector and refuses startup on invalid active configuration. Outside
production, unused collector header settings are ignored when no collector URL
is configured, preserving independent Sentry reporting. Upstream transport
failures return a sanitized 502 and a fixed-field stderr diagnostic that bypasses
telemetry exporters. The optional local SQLite sink also records the failure.

### IDE setup

```bash
cp .vscode/settings.example.json .vscode/settings.json   # VS Code
cp .zed/settings.example.json .zed/settings.json         # Zed
```

### Verification

```bash
pnpm check           # Static checks: format, lint, types, architecture, test layering, security, audit
pnpm test            # Unit, browser, and integration tests
pnpm test:property   # Focused property/invariant tests
pnpm test:e2e        # Full Playwright user journeys
pnpm verify          # Full local pre-merge gate
pnpm verify:task     # Task verification logs; add --visual, --e2e-chromium, or --build as needed
```

`pnpm verify:task` writes timestamped logs under `test-results/task-verification/`. See [AGENTS.md](AGENTS.md) and [TESTING.md](TESTING.md) for the full verification workflow, including the mutation-testing suites (`pnpm test:mutation:*`).

### E2E tests

```bash
pnpm e2e:setup  # Build shared auth context (re-run after local DB changes)
pnpm e2e        # Headless (CI command)
pnpm e2e:ui     # Playwright UI mode
```

### CodeQL

```bash
pnpm codeql:test     # Compile and test local custom queries
pnpm codeql:db       # Create test-results/codeql/start-ui-web-db
pnpm codeql:analyze  # Analyze and write test-results/codeql/start-ui-web.sarif
```

### OpenAPI

API documentation is served at `http://localhost:3000/api/openapi/app`.

### Production build & deploy

```bash
pnpm install
pnpm build    # Nitro production build → .output/
pnpm start    # node .output/server/index.mjs
```

Before deploying: use Node 24+, set production values for `DATABASE_URL`, `AUTH_SECRET`, `VITE_BASE_URL` (HTTPS), `CRON_SECRET`, `PROVIDER_WEBHOOK_SECRET`, provider credentials, and any `VITE_*` values; run versioned migrations (`pnpm db:migrate`) — never `db:push` — against production. The app deploys as a standard Nitro Node server (Vercel is the current production target; Cloudflare Workers, Railway, and Render also work — see their TanStack Start guides).

Vercel auth rate limits use its overwritten `x-vercel-forwarded-for` header
when its `VERCEL=1` deployment marker is present during build or runtime. An
explicit `AUTH_TRUSTED_CLIENT_IP_HEADER` always takes precedence.
Self-hosted production requires `AUTH_TRUSTED_CLIENT_IP_HEADER` set to a dedicated
header that the reverse proxy overwrites on every request; block direct access
to the Nitro origin. `X-Forwarded-For` is not accepted as that trusted header.
Setting `SKIP_ENV_VALIDATION=true` bypasses this startup requirement, but leaves
Better Auth using one shared sign-in rate-limit bucket. A few abusive sign-in
attempts can then temporarily lock out every user; production operators accept
that risk when enabling the bypass.

Environment hint banner for non-production deploys:

```bash
VITE_ENV_NAME="staging"
VITE_ENV_EMOJI="🔬"
VITE_ENV_COLOR="teal"
```
