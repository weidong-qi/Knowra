import type { ChildProcess } from 'node:child_process';
interface ResourceLimits {
  cpuMs: number;
  rssBytes: number;
}
import { execFile } from 'node:child_process';

/** 心跳未到时从宿主读取进程资源，避免同步死循环绕过 CPU/RSS 采样。 */
export function watchChildResources(child: Pick<ChildProcess, 'pid'>, limits: ResourceLimits, exceeded: () => void) {
  let lastHeartbeat = Date.now();
  let checking = false;
  const timer = setInterval(() => {
    if (Date.now() - lastHeartbeat < 1500 || checking || !child.pid || process.platform === 'win32') return;
    checking = true;
    execFile('ps', ['-o', 'time=', '-o', 'rss=', '-p', String(child.pid)], { timeout: 1000 }, (error, output) => {
      checking = false;
      if (error) return;
      const [cpu, rss] = output.trim().split(/\s+/);
      const cpuMs = parseCpuTime(cpu);
      const rssBytes = Number(rss) * 1024;
      if (cpuMs > limits.cpuMs || rssBytes > limits.rssBytes) exceeded();
    });
  }, 1000);
  timer.unref?.();
  return {
    report(resource: Partial<ResourceLimits> | null | undefined) {
      lastHeartbeat = Date.now();
      if ((resource?.cpuMs as number) > limits.cpuMs || (resource?.rssBytes as number) > limits.rssBytes) exceeded();
    },
    close() {
      clearInterval(timer);
    }
  };
}

function parseCpuTime(value: string | undefined) {
  if (typeof value !== 'string') return NaN;
  const [clock, dayText = '0'] = value.includes('-') ? value.split('-').reverse() : [value, '0'];
  const parts = clock.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part)) || !Number.isFinite(Number(dayText))) return NaN;
  return (Number(dayText) * 86_400 + parts.reduce((sum, part) => sum * 60 + part, 0)) * 1000;
}
