# Newsletter drafting

Report readers share newsletter settings and editorial actions in each Workspace. First enabling automation prepares published reports whose coverage overlaps the preceding 180 days, including historical citations inside those reports. Later settings saves only update settings. Disabling stops future automatic preparation; existing jobs finish and manual drafting remains available. Use **Prepare themes** for a fresh preparation and **Retry** for a failed attempt.

The app offers up to three themes, supported choices first. A selection snoozes its angle for thirty days; other angles remain available. Retry uses current settings and current evidence eligibility, retains the original report and selected angle, and links the new attempt to the previous failure. Older-report retries are supported. Abandoned or conflicting selections cannot be retried. Failed attempts remain failed and never automatically retry. A malformed candidate gets at most two repairs, is recorded and excluded when exhausted, and does not block other usable themes. Each draft shares two repairs across generation and audit failures. All counters survive resume.

Saved drafts retain their complete original article, style, evidence and audits. They remain immutable and exportable when evidence later becomes Junk, retracted or unavailable; the app shows warnings. History loads twenty entries at a time. Possible duplicate evidence can be compared and confirmed or separated. The latest explicit Keep/Junk judgment applies to equivalent content. Retraction remains independent. A changed page at the same URL is a separate version. Only clear normalized copies are automatically grouped; fuzzy similarity produces review suggestions.

## Execution and deployment

Hosted generation uses the saved model and configured API authentication. Custom model names are retained; a supported adapter discovers its context limit, otherwise settings must declare it. The resolved budget is pinned in each job. Large evidence, style samples and topic libraries are processed in resumable batches with original source ids and exact passages. Required evidence is never silently truncated to make a prompt fit.

`/api/cron/newsletter` authenticates with `CRON_SECRET`. `NEWSLETTER_INVOCATION_SECONDS` controls both its Vercel route duration and runtime deadline: 300 seconds by default, with work draining until nothing is claimable or 240 seconds have elapsed. Model and research calls receive the deadline and cancellation signal. Work yields at checkpoints when time expires. Verify the generated `.vercel/output/functions` configuration when changing this setting. Other routes retain their own platform defaults.

Jobs use a database clock, timezone-aware two-minute leases and thirty-second renewal. Execution is exclusive per Workspace across local and hosted workers. Every mutation requires its Workspace, token, running status and an unexpired lease. A worker that loses its lease cancels generation. Expired work resumes from checkpoints. Publication notification failures do not undo a successfully published report; a cheap reconciliation query recovers missing preparation jobs.

Personal execution requires `LOCAL_AI_OPERATOR_USER_ID` set to the authenticated app user's id. The worker checks that user's report-reader permission and claims only their local jobs. Other editors may select hosted generation. Changing settings preserves queued jobs' runtime and owner. Legacy ownership is assigned only by explicit migration mapping.

Run `pnpm dev:evidence` for the local worker. It checks every fifteen seconds while the application is alive. Installed Codex and Claude binaries use native authentication; subscription tokens are never copied into application storage. The text adapter uses a temporary working directory, a minimal environment without application credentials, and explicit controls disabling tools, user/repository instructions, integrations, hooks and persistence. It capability-checks the binary before generation and rejects unsupported versions. See [Codex controls](https://learn.chatgpt.com/docs/config-file/config-reference) and [Claude CLI controls](https://code.claude.com/docs/en/cli-reference). Ollama remains available.

Pages poll every five seconds only while jobs are queued or running. Idle views refresh on focus, navigation, local actions or **Refresh newsletter**. Dirty settings survive refetches and untouched audience suggestions update.

## Migration and recovery

1. Stop ingestion, callback processing and all local/hosted newsletter workers; temporarily disable scheduled invocations. Set `NEWSLETTER_WORKERS_PAUSED=true` in every running instance.
2. Supply the target `DATABASE_MIGRATION_URL` explicitly. For legacy local work, create a private JSON mapping of Workspace id to app-user id and supply its path as `WORKFLOW_OPERATOR_MAPPING_FILE`. Unmapped local jobs remain unclaimed; ownership is never guessed.
3. Run `pnpm db:migrate:workflows`. It writes a compressed recoverable snapshot under `.local-ai-runs/migration-snapshots` with owner-only permissions before applying migrations 0015/0016/0017. Do not commit or share that snapshot: it contains database payloads and authentication data.
4. The command backfills capture/version indexes, observations, judgments, equivalence groups, draft/offer/attempt/failure history and publication ledgers. It preserves all original capture and report columns, IDs, dates and saved draft payloads. Count and payload-hash verification runs inside the backfill transaction; failure rolls back the backfill and keeps the snapshot. Legacy combined-publication attempts remain recorded, and linked ledger entries prevent duplicate automatic preparation.
5. Keep the snapshot and logged digest. Restore into a separate empty database from its JSON table payloads using PostgreSQL `jsonb_populate_recordset`, loading parent tables before dependent tables, then compare row counts and payload hashes before switching the application. The additive schema migrations need not be reversed to restore legacy payloads.
6. Confirm operator mappings, model budgets and recent history, remove the pause flag, and resume ingestion and scheduled workers.

Do not use plain `db:migrate` as a substitute for this preservation/backfill workflow on a database with existing newsletter/capture history.

## Verification

Automated tests use deterministic model and subprocess fixtures, including environment/file canaries, and never spend provider credits. Integration tests prefer a disposable native PostgreSQL cluster (`TEST_POSTGRES_BIN` may specify the binary directory); otherwise the ordinary lightweight fixture uses a single connection. True multi-connection transaction and non-UTC-clock verification requires PostgreSQL. E2E fixtures require a supplied loopback `E2E_DATABASE_URL` and use real local persistence. Test artifacts and reviewed visual baselines cover authenticated desktop/mobile interactions and downloads.
