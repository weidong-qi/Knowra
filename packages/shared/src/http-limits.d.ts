export const DEFAULT_JSON_BODY_LIMIT_BYTES: number;
export const SYNC_BATCH_BODY_LIMIT_BYTES: number;
export const SYNC_BLOB_BODY_LIMIT_BYTES: number;
export const SYNC_CLIENT_BATCH_BODY_LIMIT_BYTES: number;
export const PDF_BINARY_BODY_LIMIT_BYTES: number;
export function requestBodyLimit(method: string | undefined, pathname: string): number;
