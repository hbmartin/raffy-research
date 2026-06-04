import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import {
  PageLayout,
  PageLayoutContent,
  PageLayoutTopBar,
  PageLayoutTopBarTitle,
} from '@/platform/components/page-layout/manager';
import { Badge } from '@/platform/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/platform/components/ui/card';

import { intelligenceQueries } from '../wired-queries';

export const PageWorkspaces = () => {
  const { data: workspaces } = useSuspenseQuery(
    intelligenceQueries.workspaces()
  );

  return (
    <PageLayout>
      <PageLayoutTopBar>
        <PageLayoutTopBarTitle>Workspaces</PageLayoutTopBarTitle>
      </PageLayoutTopBar>
      <PageLayoutContent containerClassName="max-w-4xl">
        {workspaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No workspaces configured yet. Seed or insert a workspace to begin.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                to="/manager/workspaces/$id"
                params={{ id: workspace.id }}
              >
                <Card className="transition hover:border-primary">
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">
                        {workspace.companyName}
                      </CardTitle>
                      <Badge variant="secondary" size="sm">
                        {workspace.timezone}
                      </Badge>
                    </div>
                    <CardDescription>{workspace.subcategory}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {workspace.companyDescription}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PageLayoutContent>
    </PageLayout>
  );
};
