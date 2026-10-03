# Newsletter drafting

Report readers share one newsletter profile, topic library, and selection history per Workspace. Open Newsletter settings below the latest report (or the empty report view after Workspace setup). Choose a runtime and model explicitly, then add house guidance or pasted writing samples. Saving enabled settings seeds all published reports; successful future publications enqueue incremental preparation.

The app presents up to three angles, supported choices first, then clearly marked research candidates. Evidence history links to captured original sources. Readers can skip, select, abandon, deliberately reuse with a recorded reason, and correct topics. A selection snoozes the semantic angle for thirty days across the Workspace. Other angles remain available. Expired angles need new claim-supporting evidence. Failed initial work releases its snooze; failed regeneration retains completed versions.

Drafts have a subject, preview, article, synthesis explanation, claim excerpts, source provenance, audit history, style snapshot, feedback, and pinned provider/model. Drafting uses public captures only. Slack, Notion, internal/private material, Junk, and retracted evidence cannot support new articles. Writing samples only supply style. Independent auditing checks factual support, attribution, counterevidence, voice, article length, and meaningful synthesis; at most two repairs are attempted. Saved versions remain immutable and exportable with warnings when evidence is later marked Junk or retracted.

## Execution and deployment

Apply the generated `0012` migration using the repository's migration workflow before starting this version. Newsletter storage requires the transaction-capable database path already used by the application; Neon HTTP delegates transactions to the existing WebSocket adapter.

Hosted jobs use the configured `OPENAI_API_KEY` and the model saved in Workspace settings. `/api/cron/newsletter` authenticates with `CRON_SECRET` and advances one durable stage each minute. Nitro requests the platform's maximum function duration; the deployment must allow the configured research budget (five minutes by default). The existing cron integration must support minute schedules.

For split-brain operation, run `pnpm dev:evidence` against the same remote database as the hosted app. Local jobs stay queued when the local app is stopped. Its background worker resumes every fifteen seconds while the process is alive; browser closure has no effect. Codex CLI and Claude Code reuse the existing local generation adapters with tool execution disabled. Existing CLI authentication, binary availability, output-directory settings, and local timeout settings apply. Ollama is also supported by the existing local adapter. Public acquisition uses the app-owned Exa adapter and the Workspace's enabled Exa credential reference; a model never directly acquires evidence through CLI tools.

Each job pins its runtime, angle, and house profile when queued. Changing settings affects newly queued work; it does not silently move pending local jobs to hosted AI. To replace pending selected work with a newly chosen runtime, save the runtime, abandon the selection, and select again. Use regeneration for an existing successful selection. To retry failed theme preparation after fixing configuration, save enabled newsletter settings again.

Jobs use renewable two-minute leases, exclusive execution per Workspace, and persistent checkpoints between model calls. Expired leases can resume on the appropriate runtime. Source acquisition records its job id so resumed research counts already captured pages against the page budget. Tracking commits report ids atomically, and completed versions are keyed by job id to prevent duplicates.

## Evidence ranking

The versioned policy weighs age-adjusted authority and momentum equally. Freshness uses a configurable exponential half-life, initially ninety days. Momentum compares unique source publications in the latest fourteen days with the preceding fourteen days. Captures share an underlying identity when their canonical URLs or normalized bodies match; near-identical syndicated bodies also share an identity. Raw captures remain available, and their earliest historical publication date prevents backfill from inflating momentum. Model assessments, claim verification, component counts, dates, and offer snapshots are retained for inspection.

## Verification

Newsletter unit tests cover ranking, excerpts, semantic-id preservation, overrides, correction history, immutable versions, audit repairs, and hosted/local parity. Database tests cover selection races, leases, public-source isolation, and bounded resumable acquisition. The Chromium workflow uses real local persistence and authenticated server functions with a deterministic model adapter. Visual fixtures cover desktop and mobile. External provider calls and a production deployment require separately configured provider credentials; the automated suite does not spend provider credits.
