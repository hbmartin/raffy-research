import { Result } from '@swan-io/boxed';

import type { PermissionChecker } from '@/modules/kernel';
import type { PermissionRequest } from '@/modules/kernel/application/ports/permission-checker';
import type { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { UserId } from '@/modules/kernel/domain/ids';

/** Resolve a permission check to a boolean, propagating infrastructure errors. */
export async function isAllowed(
  permissionChecker: PermissionChecker,
  userId: UserId,
  permissions: PermissionRequest
): Promise<Result<boolean, AppError>> {
  const result = await permissionChecker.hasPermission(userId, permissions);
  return result.map((outcome) => outcome.type === 'permission_granted');
}
