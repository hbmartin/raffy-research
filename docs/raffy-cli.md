# Raffy CLI and agent skills

Run `pnpm raffy --help` for the supported commands and flags. The CLI uses application composition directly and requires Node 24, pnpm, a trusted machine with database access, and an app-approved machine credential. It does not require a running app server after browser pairing. Native Codex/Claude authentication remains separate.

## Setup

Apply the additive migrations with the configured repository migration command (`pnpm db:migrate:evidence` when using the evidence environment files). Use a PostgreSQL connection that supports transactions. The CLI loads `.env.ai.local`, `.env.local`, then `.env` without replacing variables already present in the process environment.

```sh
pnpm raffy doctor
pnpm raffy auth login --name 'My workstation' --base-url http://localhost:3000
pnpm raffy auth whoami
pnpm raffy research workspaces
pnpm raffy research workspace --id WORKSPACE_ID
```

The login response shows a browser approval URL and comparison code. A signed-in user approves or denies the requested capability groups. Pairing expires after ten minutes; credentials expire after thirty days. Pipeline/lab grants and operational launches require the current manager role. A research/newsletter-only identity can request `--capabilities research,newsletter`.

The database stores a SHA-256 credential hash. The secret lives only in `~/.config/raffy/PROFILE.json` (private directory/file permissions), never stdout or arguments. Use `--profile NAME` to maintain separate identities/workspaces. `auth list` paginates credentials, `auth revoke --id CREDENTIAL_ID` revokes one, and `auth logout` revokes/removes the current profile. Revocation, account bans, expiry, and role changes are checked during execution.

Every workspace command requires `--workspace ID` or the explicitly saved profile default. Nothing silently selects among multiple workspaces.

## JSON and selective reading

Stdout contains one JSON envelope: `{schemaVersion:1,kind:"ok",outcome:{type:...}}` or `{schemaVersion:1,kind:"error",error:{code,category,message}}`. Logs go to stderr. Expected business conflicts remain tagged `ok` outcomes; agents must inspect `outcome.type`. Infrastructure messages are sanitized. Exit code 1 indicates a request/infrastructure failure; code 2 indicates an actionable business conflict.

Lists default to twenty entries, cap at one hundred, and return `nextCursor`. Pass it using `--cursor`. Newsletter history/review pages preserve their native cursor contract and default to twenty entries. Reports/sources are summaries; use separate detail commands:

```sh
pnpm raffy research reports --workspace WORKSPACE_ID --limit 20
pnpm raffy research report --workspace WORKSPACE_ID --report REPORT_ID --section executive_summary
pnpm raffy research evidence --workspace WORKSPACE_ID --report REPORT_ID
pnpm raffy research source --workspace WORKSPACE_ID --source SOURCE_ID --content
pnpm raffy research search --workspace WORKSPACE_ID --kind captures --query 'buyer adoption'
```

Report IDs identify immutable versions. Source IDs identify preserved captures; content fingerprints, evidence identities, original excerpts, citation URLs, and report relationships remain available. Online discovery is explicit (`research discover --query QUERY --pages 10 --key KEY`) and uses the existing Exa archive adapter.

## Durable execution

Costly starts and retries require `--key`. Generate a key once for the intended request and reuse it with identical arguments when a response is lost. The installation database scopes keys by actor, workspace, and command. An identical retry returns the original operation; changed payloads return `idempotency_conflict`. Newsletter settings/enqueueing share the transaction.

```sh
pnpm raffy pipeline ingest --workspace WORKSPACE_ID --key ingest-2026-10-04
pnpm raffy pipeline generate --workspace WORKSPACE_ID --period 2026-10-04 --key report-2026-10-04
pnpm raffy operations status --workspace WORKSPACE_ID --id OPERATION_ID
pnpm raffy operations results --workspace WORKSPACE_ID --id OPERATION_ID
pnpm raffy operations diagnostics --workspace WORKSPACE_ID --id OPERATION_ID
pnpm raffy operations diagnostics --workspace WORKSPACE_ID --id OPERATION_ID --stage 'model:report:initial'
```

Enqueue commits before provider work and promptly returns an operation ID. Starts ensure a detached worker is available. If worker startup fails, work stays recoverably queued. `worker start/status/stop` manages it; `worker run` provides a foreground mode for debugging or an existing supervisor. Worker logs are private files beside the profile. Shell/chat exit does not stop a managed worker; machine shutdown pauses until restart.

Operations use database-clock two-minute leases, thirty-second renewal, fenced writes, and durable stage checkpoints. Newsletter operations reference native jobs/selections and use their existing leases, ownership, and publication ledger. Completed stages and cached responses survive restart. Publication and its source links commit with the operation checkpoint. No arbitrary shell/code executor is exposed.

Dispatch is saved before an external request. An interruption with an unknown request outcome produces `reconciliation_required`; inspect stage diagnostics and any completed artifacts before explicitly retrying with a new key and `--acknowledge-uncertainty`. Retries create linked attempts and reuse completed checkpoints. Newsletter retries preserve the native current-settings/evidence behavior. `operations cancel --id ID` aborts active work and prevents later stages; saved captures, drafts, and published reports remain. Inspect results/checkpoints for completed side effects.

## Newsletter

Read `newsletter settings` and `newsletter offers`. Configure with a JSON profile using `newsletter configure --input FILE --key KEY`. The profile follows the existing app schema: enabled, audience, guidance, samples, runtime, halfLifeDays, researchMinutes, researchPages. Inspect the existing settings UI/schema before changing runtime/context settings; local ownership and model context limits remain enforced.

Preparation, selection, and regeneration are durable (`prepare --key`, `select --report --angle --key`, `regenerate --selection --feedback --key`). Individual `skip-angle --report --angle` applies only to the current preparation; `--unskip` reverses it. Fresh preparation can offer it again. Whole-report `skip --report` is retained. `abandon --selection`, topic corrections, and equivalence review remain focused commands.

For unavailable angles fetch fresh offers. For conflicting selections inspect current state before using an authorized `--replace`. Missing style/context requires a settings change; weak evidence requires an explicit editorial override reason. Equivalence conflicts require deliberate review, never automatic overriding.

`newsletter history`, `detail --id`, and `export --id DRAFT_ID --out PATH` retrieve selected immutable versions. Export refuses to overwrite a file.

## Quality lab and judgment provenance

```sh
pnpm raffy lab summarize --workspace WORKSPACE_ID --provider codex-cli --model MODEL --source-ids SOURCE_ID --key summary-1
pnpm raffy lab generate --workspace WORKSPACE_ID --provider codex-cli --model MODEL --key local-report-1
pnpm raffy lab evaluate --workspace WORKSPACE_ID --provider codex-cli --model MODEL --report REPORT_ID --key evaluation-1
pnpm raffy lab workflow --workspace WORKSPACE_ID --provider codex-cli --model MODEL --key workflow-1
```

Local generation immediately publishes a frozen report. The full workflow evaluates its own published report ID. Valid automated evaluations are persisted against that exact version; malformed judge output remains diagnostics. Providers are `codex-cli`, `claude-code`, or `ollama`; Ollama context allocation is pinned from local configuration. Automated verification uses deterministic fixtures, never provider credits.

Assistant rubric recommendations use `research recommend --report ID --input FILE --agent codex`. The file contains relevance, accuracy, novelty (integers 1–5), and optional note. Explicit user scores use `research score ... --human`; promoting a specifically approved recommendation uses `research promote --id RECOMMENDATION_ID --human`. Recommendations never overwrite human scores. `research judgments --target ID` retrieves immutable provenance history. Human projection remains in the existing score panel. Legacy scores are backfilled as human; unknown legacy label authorship remains unknown.

Labels (`research label --source ID --label keep|junk|clear --rationale TEXT`) still affect eligibility, with assistant authorship recorded separately from recommendations. Editorial/equivalence decisions retain actor, credential/channel, timestamps, and target IDs through history records.

Four focused skills live under `.agents/skills/raffy-{research,newsletter,pipeline,quality-lab}`; `.claude/skills` links to those canonical folders. Invoke the applicable skill for its capability. They preserve existing authorization, selectively fetch evidence, track operations, reuse idempotency keys, and never describe assistant-generated scores as human judgments.

Capture/version IDs are fetched with `research captures --source SOURCE_ID --limit 20`. Judgment lists contain compact provenance summaries; retrieve scores or rationale payloads with `research judgment --id JUDGMENT_ID`. Assistant commands can record available `--agent`, `--model`, and `--prompt-version` metadata.

Offers are paginated summaries. Fetch a selected angle’s claims, support audit, and excerpts with `newsletter angle --angle ANGLE_ID`. If a cursor returns `offers_changed`, fetch the current offers again; editorial changes can change availability.

Newsletter operation diagnostics expose native job/repair summaries. Use `operations diagnostics --id OPERATION_ID --job JOB_ID --stage REPAIR_UNIT` to fetch one cached response or repair state, or `--stage terminalFailure` for detailed failure evidence. Native newsletter history remains authoritative.
