export {
  __resetAccountComposition,
  type AccountOverrides,
  getAccountUseCases,
} from './account';
export {
  __resetAuthComposition,
  type AuthOverrides,
  getAuthUseCases,
} from './auth';
export {
  __resetIntelligenceComposition,
  getIntelligenceRepositories,
  getIntelligenceUseCases,
  type IntelligenceOverrides,
  type IntelligenceRepositories,
} from './intelligence';
export {
  __resetKernelComposition,
  getKernel,
  type KernelOverrides,
} from './kernel';
export {
  __resetUserComposition,
  getUserUseCases,
  type UserOverrides,
} from './user';

import { type AccountOverrides, getAccountUseCases } from './account';
import {
  getIntelligenceUseCases,
  type IntelligenceOverrides,
} from './intelligence';
import { getKernel, type KernelOverrides } from './kernel';
import { getUserUseCases, type UserOverrides } from './user';

export type ServicesOverrides = {
  kernel?: KernelOverrides;
  user?: Omit<UserOverrides, 'kernel'>;
  account?: Omit<AccountOverrides, 'kernel'>;
  intelligence?: Omit<IntelligenceOverrides, 'kernel'>;
};

export function getServices(overrides?: ServicesOverrides) {
  if (overrides === undefined) {
    return {
      kernel: getKernel(),
      user: getUserUseCases(),
      account: getAccountUseCases(),
      intelligence: getIntelligenceUseCases(),
    } as const;
  }

  const kernel = getKernel(overrides.kernel ?? {});
  return {
    kernel,
    user: getUserUseCases({ ...overrides.user, kernel }),
    account: getAccountUseCases({ ...overrides.account, kernel }),
    intelligence: getIntelligenceUseCases({
      ...overrides.intelligence,
      kernel,
    }),
  } as const;
}
