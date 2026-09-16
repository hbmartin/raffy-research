import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/platform/components/ui/badge';
import { Button } from '@/platform/components/ui/button';

import { formatReportAsMarkdown } from '../report-markdown';
import type { WeeklyReport } from '../../domain/report';

export const ReportHeader = (props: { report: WeeklyReport }) => {
  const data = props.report.reportData;
  const title = props.report.title ?? data?.title ?? 'Weekly Market Digest';
  const period =
    data?.period_start && data.period_end
      ? `${data.period_start} – ${data.period_end}`
      : null;

  const copyAsMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(formatReportAsMarkdown(props.report));
      toast.success('Report copied as Markdown');
    } catch {
      toast.error('Could not copy report');
    }
  };

  return (
    <header className="flex flex-col gap-1 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Badge variant="secondary" size="sm">
          {props.report.status}
        </Badge>
        {data ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => void copyAsMarkdown()}
          >
            <CopyIcon />
            Copy as Markdown
          </Button>
        ) : null}
      </div>
      {period ? (
        <p className="text-sm text-muted-foreground">
          Coverage window: {period} ({props.report.timezone})
        </p>
      ) : null}
    </header>
  );
};
