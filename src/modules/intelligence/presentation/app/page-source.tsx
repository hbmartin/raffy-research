import { useSuspenseQuery } from '@tanstack/react-query';

import {
  PageLayout,
  PageLayoutContent,
} from '@/platform/components/page-layout/app';

import type { SourceRecordId } from '@/modules/kernel/domain/ids';

import { SourceDetail } from '../source-detail';
import { intelligenceQueries } from '../wired-queries';

export const PageSource = (props: {
  sourceId: SourceRecordId;
  allowRawPayload?: boolean;
}) => {
  const { data: source } = useSuspenseQuery(
    intelligenceQueries.source(props.sourceId)
  );

  return (
    <PageLayout>
      <PageLayoutContent containerClassName="max-w-2xl">
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">
            {source.title ?? source.sourceName ?? 'Source'}
          </h1>
          <SourceDetail
            source={source}
            allowRawPayload={props.allowRawPayload}
          />
        </div>
      </PageLayoutContent>
    </PageLayout>
  );
};
