import { useSuspenseQuery } from '@tanstack/react-query';

import { Logo } from '@/platform/components/brand/logo';
import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
} from '@/platform/components/page-layout/app';

import { ReportHeader } from './report-header';
import { ReportPageBody } from '../report-page';
import { intelligenceQueries } from '../wired-queries';

export const PageLatestReport = () => {
  const { data } = useSuspenseQuery(intelligenceQueries.latestReport());

  return (
    <PageLayout>
      <PageLayoutTopBar className="md:hidden">
        <Logo className="mx-auto w-24" />
      </PageLayoutTopBar>
      <PageLayoutContent containerClassName="max-w-4xl">
        {data.report ? (
          <div className="flex flex-col gap-6">
            <ReportHeader report={data.report} />
            <ReportPageBody report={data.report} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
            <h1 className="text-xl font-semibold">No report yet</h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Your first weekly market intelligence digest will appear here once
              it has been generated.
            </p>
          </div>
        )}
      </PageLayoutContent>
    </PageLayout>
  );
};
