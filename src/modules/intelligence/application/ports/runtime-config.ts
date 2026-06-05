export type IntelligenceRuntimeConfig = {
  cronSecret?: string;
  openAiApiKey?: string;
  openAiModel: string;
  slackAlertWebhookUrl?: string;
  getProviderCredential(ref: string | null): string | undefined;
};
