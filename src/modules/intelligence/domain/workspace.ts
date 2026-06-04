import type {
  CompetitorId,
  KeywordId,
  SocialAccountId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

export const DEFAULT_WORKSPACE_TIMEZONE = 'America/Los_Angeles';

export type CompetitorState = 'accepted' | 'suggested' | 'ignored';

export type Workspace = {
  id: WorkspaceId;
  name: string;
  companyName: string;
  companyDescription: string;
  subcategory: string;
  timezone: string;
  website: string | null;
  positioning: string | null;
  icp: string | null;
  marketAssumptions: string | null;
  gtmFocus: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkspaceWriteInput = {
  name: string;
  companyName: string;
  companyDescription: string;
  subcategory: string;
  timezone?: string;
  website?: string | null;
  positioning?: string | null;
  icp?: string | null;
  marketAssumptions?: string | null;
  gtmFocus?: string | null;
};

export type Keyword = {
  id: KeywordId;
  workspaceId: WorkspaceId;
  keywordString: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SocialAccount = {
  id: SocialAccountId;
  workspaceId: WorkspaceId;
  platform: string | null;
  username: string | null;
  profileUrl: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Competitor = {
  id: CompetitorId;
  workspaceId: WorkspaceId;
  name: string;
  domain: string | null;
  state: CompetitorState;
  createdAt: Date;
  updatedAt: Date;
};

export function normalizeWorkspaceWriteInput(
  input: WorkspaceWriteInput
): Required<Omit<WorkspaceWriteInput, 'timezone'>> & { timezone: string } {
  const trimOrNull = (value: string | null | undefined) =>
    value?.trim() ? value.trim() : null;

  return {
    name: input.name.trim(),
    companyName: input.companyName.trim(),
    companyDescription: input.companyDescription.trim(),
    subcategory: input.subcategory.trim(),
    timezone: input.timezone?.trim() || DEFAULT_WORKSPACE_TIMEZONE,
    website: trimOrNull(input.website),
    positioning: trimOrNull(input.positioning),
    icp: trimOrNull(input.icp),
    marketAssumptions: trimOrNull(input.marketAssumptions),
    gtmFocus: trimOrNull(input.gtmFocus),
  };
}
