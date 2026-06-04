import { useSuspenseQuery } from '@tanstack/react-query';

import {
  PageLayout,
  PageLayoutContent,
} from '@/platform/components/page-layout/app';

import type { WeeklyReportId } from '@/modules/kernel/domain/ids';

import { ReportHeader } from './report-header';
import { ReportPageBody } from '../report-page';
import { intelligenceQueries } from '../wired-queries';

export const PageReport = (props: { reportId: WeeklyReportId }) => {
  const { data: report } = useSuspenseQuery(
    intelligenceQueries.report(props.reportId)
  );

  return (
    <PageLayout>
      <PageLayoutContent containerClassName="max-w-4xl">
        <div className="flex flex-col gap-6">
          <ReportHeader report={report} />
          <ReportPageBody report={report} />
        </div>
      </PageLayoutContent>
    </PageLayout>
  );
};
