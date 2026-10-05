# Repository command

Run from the repository root. `pnpm linkedin:monitoring` loads `.env.ai.local`, `.env.local`, then `.env`, and uses `run-jiti`. Each command requires `--workspace <id>`; credentials and task/schedule IDs come from workspace configuration.

| Command | Purpose |
| --- | --- |
| `context` | Workspace goals, keywords, competitors, watchlist, safe provider identifiers, pending sync. |
| `plan --input <file>` | Validate a selection and compare database/Apify targets without mutations. |
| `add --input <file>` | Commit approved profiles and pending state, then synchronize and verify Apify. |
| `sync` | Resume the pending synchronization without adding accounts. |
| `verify` | Read and compare active database targets with Apify. |

`--input` is accepted only by `plan` and `add`. `--help` requires no workspace. Output is versioned JSON. Exit 0 means success, 1 means infrastructure/I/O failure, and 2 means invalid input or review/recovery required. Verified targets with an outstanding pending record still exit 2 until `sync` finalizes it.

## Selection JSON

```json
{
  "workspaceId": "workspace-id",
  "profiles": [
    {
      "url": "https://www.linkedin.com/in/example-person/",
      "name": "Example Person",
      "reason": "Buyer perspective on a missing research topic",
      "evidence": [
        {
          "url": "https://www.linkedin.com/posts/example-post",
          "note": "Observed post discussing the topic",
          "observedAt": "2026-10-04T21:00:00Z"
        }
      ]
    }
  ]
}
```

Only `url` is required for each profile. `name`, `reason`, and `evidence` are optional; each evidence reference needs `url` and `note`, with optional `observedAt`. Extra fields (such as role or coverage category) belong in the shortlist, not the selection. The command accepts 1–100 selected people, rejects duplicate canonical URLs and workspace mismatches, and accepts only person `/in/` URLs for additions. Names are optional human labels; URLs establish identity.

## Recovery and artifacts

`add` and `sync` return `auditPath` and `recoveryCommand`, writing private JSON artifacts below `test-results/task-verification/<timestamp>/linkedin-monitoring/`. Selection provenance also persists in social-account metadata. Artifact paths are local and ignored by Git.

Pending state lives at `providerConfig.config.linkedinMonitoringPending`, including task ID, baseline targets, intended targets, creation time, and a sanitized failure code when available. Successful synchronization clears it, updates `targetCount`, and records `linkedinMonitoringLastSyncedAt`. Existing provider configuration is preserved.

Retry with `sync` when Apify still has the recorded baseline or already has the intended targets. New remote changes require review. A changed task ID, unsupported target, schedule target override, or duplicate account stops synchronization. The command preserves task settings and schedule; it neither launches scraping nor creates a background retry worker.
