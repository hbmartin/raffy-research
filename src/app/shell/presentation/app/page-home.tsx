import { Logo } from '@/platform/components/brand/logo';
import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
} from '@/platform/components/page-layout/app';

export const PageHome = () => {
  return (
    <PageLayout>
      <PageLayoutTopBar className="md:hidden">
        <Logo className="mx-auto w-24" />
      </PageLayoutTopBar>
      <PageLayoutContent>
        <div className="flex min-h-[60dvh] flex-col justify-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Weekly Market Intelligence
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-normal">
            No weekly reports have been published yet.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Configure a workspace in the manager area, ingest sources, and the
            first frozen weekly report will appear here.
          </p>
        </div>
      </PageLayoutContent>
    </PageLayout>
  );
};
