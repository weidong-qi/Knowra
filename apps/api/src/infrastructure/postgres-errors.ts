import { createAppError } from '../errors/app-error.ts';
import type { AppError } from '../errors/app-error.ts';

export interface PostgresErrorOptions {
  fallbackCode?: string;
  fallbackMessage?: string;
  uniqueCode?: string;
  uniqueMessage?: string;
  concurrentCode?: string;
  concurrentMessage?: string;
}

export function mapPostgresError(
  error: unknown,
  {
    fallbackCode = 'DATABASE_OPERATION_FAILED',
    fallbackMessage = 'PostgreSQL operation failed',
    uniqueCode = 'DATABASE_CONFLICT',
    uniqueMessage = 'PostgreSQL unique constraint conflict',
    concurrentCode = 'DATABASE_CONCURRENT_UPDATE',
    concurrentMessage = 'The record changed during this operation; reload and retry'
  }: PostgresErrorOptions = {}
) {
  if ((error as Partial<AppError> | null | undefined)?.code === 'P2002') {
    return createAppError(uniqueCode, uniqueMessage, 409, { cause: error });
  }
  if ((error as Partial<AppError> | null | undefined)?.code === 'P2003') {
    return createAppError('DATABASE_REFERENCE_INVALID', 'PostgreSQL foreign-key reference is invalid', 422, {
      cause: error
    });
  }
  if ((error as Partial<AppError> | null | undefined)?.code === 'P2025') {
    return createAppError('DATABASE_RECORD_NOT_FOUND', 'PostgreSQL record was not found', 404, { cause: error });
  }
  if ((error as Partial<AppError> | null | undefined)?.code === 'P2034') {
    return createAppError(concurrentCode, concurrentMessage, 409, { cause: error });
  }
  return createAppError(fallbackCode, fallbackMessage, 500, { cause: error });
}

export async function withPostgresErrors<Result>(
  operation: () => Result | PromiseLike<Result>,
  options: PostgresErrorOptions = {}
): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (
      (error as Partial<AppError> | null | undefined)?.code?.startsWith?.('DATABASE_') ||
      ((error as Partial<AppError> | null | undefined)?.code &&
        Number.isInteger((error as Partial<AppError> | null | undefined)?.statusCode))
    ) {
      throw error;
    }
    throw mapPostgresError(error, options);
  }
}
