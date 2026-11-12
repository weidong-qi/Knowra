import type { AppError } from '../../../errors/app-error.ts';
import { createAppError } from '../../../errors/app-error.ts';

export function validationError(code: string, message: string): AppError {
  return createAppError(code, message, 422);
}

export function notFoundError(code: string, message: string): AppError {
  return createAppError(code, message, 404);
}

export function conflictError(code: string, message: string): AppError {
  return createAppError(code, message, 409);
}
