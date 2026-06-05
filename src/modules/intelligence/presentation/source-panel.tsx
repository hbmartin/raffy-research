import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/platform/components/ui/badge';
import { ScrollArea } from '@/platform/components/ui/scroll-area';
import { Separator } from '@/platform/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/platform/components/ui/sheet';
import { Skeleton } from '@/platform/components/ui/skeleton';

import { toSourceRecordId } from '@/modules/kernel/domain/ids';

import { SourceDetail } from './source-detail';
import { intelligenceQueries } from './wired-queries';

export type SourcePanelProps = {
  sourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When true, the raw provider payload is revealed (admin/debug only). */
  allowRawPayload?: boolean;
};

export const SourcePanel = (props: SourcePanelProps) => {
  const query = useQuery({
    ...intelligenceQueries.source(
      toSourceRecordId(props.sourceId ?? 'pending')
    ),
    enabled: props.open && Boolean(props.sourceId),
  });

  const source = query.data ?? null;

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-6 text-left">
            {source?.title ?? source?.sourceName ?? 'Source'}
          </SheetTitle>
          <SheetDescription className="text-left">
            {source ? (
              <Badge variant="secondary" size="sm">
                {source.sourceType}
              </Badge>
            ) : (
              'Loading source…'
            )}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="flex-1">
          <div className="p-4">
            {query.isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : null}
            {source ? (
              <SourceDetail
                source={source}
                allowRawPayload={props.allowRawPayload}
              />
            ) : null}
            {!query.isLoading && !source ? (
              <p className="text-sm text-muted-foreground">Source not found.</p>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
