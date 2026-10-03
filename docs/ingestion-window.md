# How daily ingestion decides what to fetch

Every pull provider answers one question on each run: **"which items should I
ask for this time?"** The answer is a time window that starts at `periodStart`
and ends now. This document explains how that window is chosen, why there are
two strategies, and what happens when ingestion runs more than once a day.

The daily cron runs at **14:00 UTC** (`vercel.json`). Ingestion can also run
on demand from the manager page ("Ingest enabled", full workflow) or when the
cron is retried.

## The problem this solves

Before this change, every run asked for **"the last 24 hours"**, whatever
time it was and whenever the previous run had happened. That caused two
problems.

**1. Duplicates from re-runs.** A second run on the same day overlapped the
first one, and everything in the overlap was stored again:

```
Run A, 2 Oct 10:00  →  asks for 1 Oct 10:00 … 2 Oct 10:00
Run B, 2 Oct 14:00  →  asks for 1 Oct 14:00 … 2 Oct 14:00
                             └── 20 hours overlap → stored twice
```

**2. Lost Exa articles.** Exa often records only the *date* an article was
published, stored as midnight UTC, and it indexes articles hours or days
after publication. An article could fall through the gap between two windows:

| Time (UTC)  | What happens |
|-------------|--------------|
| 2 Oct 13:50 | Competitor publishes "Acme launches AI recall reminders". |
| 2 Oct 14:00 | Cron run asks for articles published since 1 Oct 14:00. Exa hasn't indexed the article yet, so it isn't returned. |
| 2 Oct 14:10 | Exa indexes it, with publish date **2 Oct 00:00** (date only). |
| 3 Oct 14:00 | Cron run asks for articles published since **2 Oct 14:00**. Exa thinks the article was published at 00:00, before the window, so it is filtered out. **Lost for good.** |

## Strategy 1: "since the last successful pull" (default provider window)

Each run starts where the provider's **last fully successful pull started**.
Consecutive runs then cover adjoining windows, with no gap and no overlap:

```
Run A, 2 Oct 10:00  →  no previous success: last 24h  →  1 Oct 10:00 … 2 Oct 10:00
Run B, 2 Oct 14:00  →  last success started 10:00   →  2 Oct 10:00 … 2 Oct 14:00
Run C, 3 Oct 14:00  →  last success started 14:00   →  2 Oct 14:00 … 3 Oct 14:00
```

Rules (`resolveIngestWindowStart` in `src/modules/intelligence/domain/ingestion.ts`):

- **No successful pull yet:** start 24 hours ago (the old behaviour).
- **Only `succeeded` pulls count.** If a pull was `partial` or `failed` (for
  example, one provider request errored), the start does not move forward, so
  the next run covers that window again instead of leaving a hole.
- **Never more than 7 days back.** If a provider was disabled for a month,
  re-enabling it fetches the last week, not the whole month.
- **Never in the future.** A bad or clock-skewed timestamp is pulled back to now.

What each provider does with the window:

| Provider | How it uses `periodStart` |
|----------|---------------------------|
| Ahrefs / Semrush | Doesn't use it. These are metric snapshots, so each run still stores one snapshot per competitor. |

Each run records its window in `ingestionRun.metadata` as `periodStart` and
`periodEnd`, so you can check that windows line up.

## Strategy 2: overlapping lookback + skip exact copies (Exa)

For Exa a narrow window is unsafe, because of the lost-article problem above.
So Exa does the opposite: **every run searches the last 3 days**
(`EXA_LOOKBACK_MS` in `providers/exa.ts`), overlapping earlier runs on purpose.
The 3 days absorb day-only dates and typical indexing delay.

The overlap means most results were already stored by earlier runs. Before
writing, ingestion drops every result that is an **exact copy** of a record
already stored for Exa in that 3-day period. A result is an exact copy only
when **both** of these match:

1. **Same page.** The URLs are compared after canonicalization: case, `www.`,
   `http`/`https`, trailing slash, `#fragment` and tracking parameters such as
   `utm_*` are ignored (`canonicalizeSourceUrl` in `domain/url.ts`).
2. **Same text.** The page text is identical (compared by MD5 hash).

A page whose text changed is **a new version and is kept**. That preserves
ADR 0003's rule that every distinct capture is retained.

### Worked example (Exa)

| Time (UTC)  | Run | Searches published since | Exa returns | Stored? |
|-------------|-----|--------------------------|-------------|---------|
| 2 Oct 13:50 | — | — | (competitor publishes the launch article) | — |
| 2 Oct 14:00 | cron | 29 Sep 14:00 | pricing page P (text v1); launch article not indexed yet | P v1 **stored** |
| 2 Oct 14:10 | — | — | Exa indexes the launch article L, dated 2 Oct 00:00 | — |
| 2 Oct 16:00 | manual | 29 Sep 16:00 | P (text v1), L | P: exact copy → **skipped**. L: new → **stored** |
| 3 Oct 09:00 | — | — | competitor edits P (text v2) | — |
| 3 Oct 14:00 | cron | 30 Sep 14:00 | P (text v2), L, `L?utm_source=x` | P v2: text changed → **stored**. L and its `utm` link: exact copies → **skipped** |

Result: the launch article is captured once even though its date is
"midnight" and it was indexed after a run. The re-run on 2 Oct stored nothing
twice, and the pricing page edit is kept as a second version.

The run record shows how many results were dropped, in
`ingestionRun.metadata.storedCopiesSkipped`.

## Known limits

- **Exa's 10 results per keyword are shared across 3 days.** On a busy
  keyword, older already-stored articles can take slots that a brand-new
  article would otherwise have had. If coverage looks thin, raise `numResults`
  in `providers/exa.ts`, which costs more per search.
- **Pages whose text changes on every fetch** (a live clock, rotating ads in
  the text) never match as copies, so they are stored again on each run.
- **The same page under two keywords in one run** is still stored once per
  keyword. Exact-copy skipping only compares against records already in the
  database, not within one batch.
- **Webhook providers** (Apify, Awario, Trigify, ForumScout, Visualping,
  Distill) push data to us, so no window applies. Redelivered webhooks and
  "Reprocess callbacks" still create duplicates.
- **Ahrefs / Semrush** store a new snapshot on every run, including re-runs.
- **Records already in the database are not touched.** Duplicates created
  before this change stay as they are.

## Where the code is

| What | File |
|------|------|
| Choosing the window per provider | `src/modules/intelligence/application/use-cases/ingestion/run-workspace-ingest.ts` |
| "Since last success" rule | `resolveIngestWindowStart` in `src/modules/intelligence/domain/ingestion.ts` |
| Last successful pull lookup | `getLastSuccessfulDailyRun` in `infrastructure/drizzle/ingestion-repository-drizzle.ts` |
| Exact-copy check | `excludeStoredCopies` in `infrastructure/drizzle/source-repository-drizzle.ts` |
| Opting a provider into the overlapping lookback | `overlappingWindow` on `ProviderAdapter` (`application/ports/provider-adapter.ts`) |
| Exa lookback | `EXA_LOOKBACK_MS` in `infrastructure/providers/exa.ts` |
