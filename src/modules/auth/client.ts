import { createUseAuthSession } from './presentation/client';
import { createAuthQueryHooks } from './presentation/queries';
import { authQueries } from './presentation/wired-queries';
import { createWithPermissions } from './presentation/with-permissions';

export {
  type AuthClientResult,
  authErrorCodes,
  type AuthSignInProvider,
  checkRolePermission,
  signOut,
  startSignIn,
  type StartSignInInput,
  type StartSignInResult,
} from './presentation/client';
export { AUTH_SIGNUP_ENABLED } from './presentation/config';
export { ConfirmSignOut } from './presentation/confirm-signout';
export {
  type AuthQueryFacade,
  clearAllQueryStateForAuthBoundary,
  createAuthQueries,
  createAuthQueryHooks,
} from './presentation/queries';
export type {
  FormFieldsLogin,
  FormFieldsOnboarding,
} from './presentation/schema';
export { zFormFieldsLogin, zFormFieldsOnboarding } from './presentation/schema';
export { authQueries } from './presentation/wired-queries';

const authQueryHooks = createAuthQueryHooks(authQueries);

export const useCurrentSessionQuery = authQueryHooks.useCurrentSessionQuery;
export const useCurrentScopeKey = authQueryHooks.useCurrentScopeKey;
export const useAuthSession = createUseAuthSession(useCurrentSessionQuery);
export const WithPermissions = createWithPermissions(useAuthSession);
