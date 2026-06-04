import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
  PageLayoutTopBarTitle,
} from '@/platform/components/page-layout/manager';

export const PageDashboard = () => {
  return (
    <PageLayout>
      <PageLayoutTopBar>
        <PageLayoutTopBarTitle>Dashboard</PageLayoutTopBarTitle>
      </PageLayoutTopBar>
      <PageLayoutContent containerClassName="max-w-4xl">
        <div className="flex min-h-[50dvh] flex-col justify-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            Operations
          </p>
          <h1 className="text-3xl font-semibold tracking-normal">
            Configure intelligence workspaces from this area.
          </h1>
          <p className="text-base text-muted-foreground">
            Workspace, provider, and report controls will live in the manager
            navigation as the market intelligence product is added.
          </p>
        </div>
      </PageLayoutContent>
    </PageLayout>
  );
};
