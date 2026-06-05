import { AppError } from '@/modules/kernel/domain/errors/app-error';

/** Map an unknown persistence error to a tagged intelligence AppError. */
export function mapIntelligenceDbError(error: unknown, code: string): AppError {
  if (error instanceof AppError) return error;

  return new AppError({
    code,
    category: 'system',
    status: 500,
    message: 'Intelligence repository error',
    cause: error,
  });
}

/** A persistence invariant was violated (e.g. an insert returned no row). */
export function intelligenceInvariantError(
  code: string,
  message: string
): AppError {
  return new AppError({ code, category: 'system', status: 500, message });
}
