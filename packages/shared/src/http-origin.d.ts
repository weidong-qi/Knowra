export interface OriginRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { encrypted?: boolean; remoteAddress?: string };
}
export interface OriginOptions {
  allowedOrigins?: string[];
  trustProxy?: boolean;
}
export interface OriginDecision {
  allowed: boolean;
  sameOrigin: boolean;
}
export function isWriteMethod(method: string | undefined): boolean;
export function writeOriginDecision(request: OriginRequest, options?: OriginOptions): OriginDecision;
