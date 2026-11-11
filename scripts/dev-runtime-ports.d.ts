// 历史端口文件由 JSON 直接读取，未验证的值不能承诺为数字。
export function readRuntimePorts(filePath?: string): unknown;
export function writeRuntimePort(filePath: string, service: string, port: number): Record<string, unknown>;
export function clearRuntimePort(filePath: string, service: string): unknown;
export function resolveApiPort(options: {
  envApiPort?: string | number;
  runtimePorts?: { api?: string | number };
  webPort?: number;
  fallbackPort?: number;
}): number;
