---
name: raffy-newsletter
description: Edit Raffy newsletters through focused configuration, offers, editorial decisions, durable drafting, evidence review, and immutable export.
---

Run commands from the Raffy repository using `pnpm raffy`. This requires shell access, configured database access, and a browser-approved machine credential. Run `pnpm raffy doctor`, `pnpm raffy auth whoami`, and `pnpm raffy --help` when setup or command details are needed. If authentication is missing, use `pnpm raffy auth login`; the human approves the displayed machine and code in their authenticated browser. Never read or print the private profile secret, or copy Codex/Claude subscription tokens.

Pass `--workspace WORKSPACE_ID` or use an explicitly saved profile workspace. Discover IDs with `research workspaces`; never choose silently among multiple workspaces. Commands emit versioned JSON: inspect `kind`, then the tagged `outcome.type`. An expected conflict is an `ok` business outcome and still requires recovery. Lists use `--limit 20` and `--cursor NEXT_CURSOR`; fetch detail only for relevant IDs.

Preserve existing user authorization. A new confirmation is unnecessary when the requested action is already authorized. Keep assistant judgments, human submissions, and automated evaluations distinct. Do not use `--human` unless the user explicitly supplied or approved the particular scores. Cite immutable report IDs and source IDs/URLs, retain excerpts verbatim, and identify who made each judgment.

For costly starts, generate an idempotency key once and reuse it with identical arguments after a timeout or lost response. Changed arguments require a new key. Save the operation ID returned promptly; monitor with `operations status --id OPERATION_ID`, inspect `operations results`, and use `operations diagnostics --id OPERATION_ID` for stage summaries/events. Fetch a specific checkpoint with `--stage STAGE_NAME`. Cancellation requests abort execution and preserve saved artifacts. Retries require a new key and retain a parent attempt. If `reconciliation_required` or `retry_acknowledgment_required` appears, inspect the recorded dispatch and existing artifacts before acknowledging uncertainty with `operations retry --id OPERATION_ID --key NEW_KEY --acknowledge-uncertainty`; never silently rerun an uncertain paid call. Work survives the initiating shell/chat. `worker start/status/stop` manage execution; stopping pauses until restart.

Read `newsletter settings`, then `newsletter offers`. Configure an audience, style guidance/samples, and runtime with `newsletter configure --input PROFILE_JSON --key KEY`; inspect `pnpm raffy --help` and `docs/raffy-cli.md` for configuration examples. Run `newsletter prepare --key KEY`, track its operation, and fetch the refreshed offers before choosing an angle.

Select with `newsletter select --report REPORT_ID --angle ANGLE_ID --key KEY`. Individual `newsletter skip-angle --report REPORT_ID --angle ANGLE_ID` applies only to this preparation; other angles remain available and a fresh preparation can offer it again. `--unskip` reverses it. Whole-report `newsletter skip --report REPORT_ID` remains available. Never substitute one skip scope for another.

`angle_unavailable`: fetch current offers and propose another available angle; do not select an obsolete ID. `selection_conflict`: inspect the current selection and ask only if replacing it was not already authorized. `--replace` implements an explicitly authorized replacement. `style_required`, missing context, or budget conflicts: inspect settings and resolve the stated configuration. `override_required`: report the evidence limitation and use `--override-reason` only for an authorized editorial override. Equivalence conflicts require reviewing `newsletter reviews` and a deliberate `newsletter review --review REVIEW_ID --action confirm|separate|reverse`; never auto-resolve to force generation.

Regenerate with `newsletter regenerate --selection SELECTION_ID --feedback FEEDBACK --key KEY`; abandon with `newsletter abandon --selection SELECTION_ID`. Correct topics with `newsletter correct --topic TOPIC_ID --action rename|merge|split|assign` and the corresponding title/target/source IDs. Decisions retain assistant provenance.

List `newsletter history`; fetch a selected immutable entry using `newsletter detail --id ENTRY_ID`. Export a specific draft version with `newsletter export --id DRAFT_ID --out OUTPUT_PATH`. Export never replaces an existing file. Retain citation URLs, excerpts, evidence warnings, report IDs, and draft version IDs when presenting or exporting content.

Offers are paginated summaries. Fetch a selected angle’s claims, support audit, and excerpts with `newsletter angle --angle ANGLE_ID`. If a cursor returns `offers_changed`, fetch the current offers again; editorial changes can change availability.

Newsletter operation diagnostics expose native job/repair summaries. Use `operations diagnostics --id OPERATION_ID --job JOB_ID --stage REPAIR_UNIT` to fetch one cached response or repair state, or `--stage terminalFailure` for detailed failure evidence. Native newsletter history remains authoritative.
