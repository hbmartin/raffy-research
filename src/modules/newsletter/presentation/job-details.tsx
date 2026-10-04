import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { newsletterQueries } from './wired-queries';

export function JobDetails({
  workspaceId,
  jobId,
}: {
  workspaceId: string;
  jobId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    ...newsletterQueries.jobDetail(workspaceId, jobId),
    enabled: expanded,
  });
  const detail =
    query.data?.type === 'job_detail_found' ? query.data : undefined;
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">
        Audit and repair details
      </summary>
      {query.isFetching ? <p>Loading details…</p> : null}
      {query.isError ? <p role="alert">Could not load job details.</p> : null}
      {detail ? (
        <div className="mt-2 space-y-2 break-words">
          {detail.budget ? (
            <p>
              Context {detail.budget.contextTokens.toLocaleString()} · Response
              cap {detail.budget.outputTokens.toLocaleString()} ·{' '}
              {detail.budget.origin}
            </p>
          ) : null}
          {detail.audits.map((audit, i) => (
            <div key={i}>
              <p>
                Audit pass {i + 1}:{' '}
                {audit.issues.join('; ') || 'See individual checks.'}
              </p>
              {audit.claimChecks
                .filter((check) => !check.supported)
                .map((check, index) => (
                  <p key={index}>
                    {check.text}: {check.explanation}
                  </p>
                ))}
            </div>
          ))}
          <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
            {detail.failureHistoryJson}
          </pre>
          <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
            {detail.failureDetailsJson}
          </pre>
          {Object.entries(detail.repairUnits).map(([unit, state]) => (
            <div key={unit}>
              <p>
                {unit}: {state.repairsUsed}/2 repairs used
                {state.requestInFlight ? ' · interrupted dispatch' : ''}
              </p>
              {state.issues?.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
              {state.rejectedJson !== undefined ? (
                <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">
                  {state.rejectedJson}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}
