import { z } from 'zod';

export const providerNames = [
  'apify',
  'exa',
  'awario',
  'trigify',
  'forumscout',
  'visualping',
  'distill',
  'semrush',
  'ahrefs',
  'slack',
  'notion',
] as const;

export const competitorStates = ['accepted', 'suggested', 'ignored'] as const;
export const reportStatuses = ['generated', 'published', 'failed'] as const;
export const reportSourceRelationTypes = ['cited', 'relevant_unused'] as const;
export const feedbackEventTypes = [
  'useful',
  'not_useful',
  'more_like_this',
  'less_like_this',
  'flag_bad_synthesis',
  'open_source',
  'copy_excerpt',
  'add_competitor_to_watchlist',
] as const;

export type ProviderName = (typeof providerNames)[number];
export type CompetitorState = (typeof competitorStates)[number];
export type ReportStatus = (typeof reportStatuses)[number];
export type ReportSourceRelationType =
  (typeof reportSourceRelationTypes)[number];
export type FeedbackEventType = (typeof feedbackEventTypes)[number];

export const zProviderName = () => z.enum(providerNames);
export const zCompetitorState = () => z.enum(competitorStates);
export const zReportStatus = () => z.enum(reportStatuses);
export const zReportSourceRelationType = () =>
  z.enum(reportSourceRelationTypes);
export const zFeedbackEventType = () => z.enum(feedbackEventTypes);

export type WorkspaceConfig = {
  id: string;
  name: string;
  companyName: string;
  companyDescription: string;
  subcategory: string;
  timezone: string;
  companyWebsite?: string | null;
  currentPositioning?: string | null;
  knownIcp?: string | null;
  knownMarketAssumptions?: string | null;
  gtmFocusNotes?: string | null;
};
