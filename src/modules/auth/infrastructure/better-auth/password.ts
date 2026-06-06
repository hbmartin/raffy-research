import { hashPassword } from 'better-auth/crypto';

export const betterAuthCredentialProviderId = 'credential' as const;

export const hashBetterAuthPassword = (password: string) =>
  hashPassword(password);
