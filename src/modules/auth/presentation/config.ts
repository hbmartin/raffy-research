import { isAuthSignupEnabled } from '@/modules/auth';
import { envClient } from '@/platform/env/client';

export const AUTH_SIGNUP_ENABLED = isAuthSignupEnabled({
  isDemo: envClient.VITE_IS_DEMO,
});
