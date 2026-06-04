export type IntelligenceRuntimeConfig = {
  cronSecret?: string;
  openAiApiKey?: string;
  openAiModel: string;
  providerCallbackSecret?: string;
  providerCredentials: Partial<Record<string, string>>;
  slackAlertWebhookUrl?: string;
};
