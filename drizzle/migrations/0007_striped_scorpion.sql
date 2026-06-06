DROP INDEX "weeklyReport_workspace_period_key";--> statement-breakpoint
CREATE INDEX "weeklyReport_workspace_period_idx" ON "weeklyReport" USING btree ("workspaceId","periodStart");--> statement-breakpoint
CREATE INDEX "weeklyReport_workspace_published_idx" ON "weeklyReport" USING btree ("workspaceId","periodStart","publishedAt");