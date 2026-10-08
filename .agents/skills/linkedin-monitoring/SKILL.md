---
name: linkedin-monitoring
description: Find and recommend LinkedIn people for a Raffy workspace, then add user-selected profiles and verify or recover Apify watchlist synchronization.
---

# LinkedIn monitoring

Use this repository's `pnpm linkedin:monitoring` command for context, additions, and recovery. Do not recreate database or Apify mutation scripts. This is a trusted operator command using the repository environment, separate from the browser-approved `pnpm raffy` app CLI.

## Discover people

- Resolve the workspace from the user's request or current conversation. If needed, use available workspace listing tools (including `pnpm raffy research workspaces` when available); ask only if multiple workspaces remain plausible. Every monitoring command requires the explicit ID.
- Run `pnpm linkedin:monitoring context --workspace <id>`. Read the goals, keywords, competitors, active watchlist, and pending synchronization status. Resolve pending synchronization before approving a new addition batch.
- Load the installed `browser:control-in-app-browser` skill and follow its browser controls. Reuse the signed-in LinkedIn session. If LinkedIn requires authentication, open its sign-in page and ask the user to sign in; resume after they say they are logged in. Browser login is for research; Apify uses its configured provider credential.
- Organize searches around gaps in current coverage, with extra weight for buyer voices. Consider relevant competitor and industry perspectives too. Review the person's profile and recent activity, usually the last 60 days. Follow promising authors from topic searches and verify their roles on their profiles.
- Recommend up to seven people by default, assessing topic fit, recent activity, original contributions, and overlap with existing monitoring. A valuable buyer with sparse posts may qualify; explicitly disclose the limited activity. Exclude already-active profiles from new recommendations.
- Present numbered recommendations with profile URLs, observed current roles, the coverage gap addressed, and supporting post links or other observed activity. Separate observed facts from your reasons for recommending them. Do not invent posts, roles, dates, or activity counts.
- Save the shortlist under `test-results/task-verification/<timestamp>/linkedin-monitoring/shortlist.json`. Include workspace ID, profile URLs, names, roles, reasons, and observed evidence. Shortlisting alone authorizes no additions.

## Add selected people

Read [the command contract](references/command-contract.md) for input format, exit codes, and recovery.

The user's selection authorizes applying those profiles. Follow-ups such as “add all seven” refer to the existing shortlist: save that selection and apply it without another confirmation or another discovery pass. A direct request to add supplied profile URLs also authorizes addition and does not require researching evidence first.

Save only the selected entries in `selection.json` using the command's strict input schema. Run `plan --input <selection.json> --workspace <id>` to inspect the intended changes, then `add` with the same arguments. An unexplained target difference, ambiguous account, invalid configuration, or pending sync stops new additions. Report the concrete outcome and artifact path.

An unsuccessful add may have committed approved profiles with pending synchronization. Inspect `context` and `verify`; use `sync --workspace <id>` to retry the same authorized batch when its baseline remains valid. If targets/configuration changed unexpectedly, report the differences for review; do not overwrite them, remove accounts, or create another batch. Do not automatically loop on failures.

The command normalizes person URLs, reuses existing accounts, reactivates selected inactive accounts, preserves existing company targets, and verifies Apify after updating its target list. It does not launch a scrape. Report agreement or pending recovery clearly; do not claim completion from a database insert alone.
