import { syncContract } from '../../api/src/modules/sync/protocol-contract.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Note } from '../../api/src/modules/knowledge/domain/note.js';
import { createSyncEngine } from '../src/sync-engine.mjs';
import { writeMeta } from '../src/sync-state.mjs';
import { openWorkspace } from './helpers.mjs';

const durationMs = Number(process.env.KNOWRA_IDLE_DURATION_MS ?? 600000);
const count = Number(process.env.KNOWRA_IDLE_NOTES ?? 3600);
const output = process.env.KNOWRA_IDLE_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('请指定绝对路径 KNOWRA_IDLE_OUTPUT。');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowra-sync-idle-'));
const { store } = openWorkspace(root);
const epoch = 'idle-benchmark';
const cursor = 'idle-cursor';
let engine;
try {
  store.syncTransaction((db, state) => {
    for (let index = 0; index < count; index++) {
      const content = `同步样本 ${index}\n${'用于测试空闲同步的中文正文。'.repeat(32)}`;
      const hash = createHash('sha256').update(content).digest('hex');
      const note = new Note({
        id: `idle-note-${index}`,
        spaceId: state.spaces[0].id,
        title: `笔记 ${index}`,
        rawMarkdown: content,
        contentHash: hash
      });
      state.notes.push(note);
      state.noteVersions.push({
        id: `idle-version-${index}`,
        noteId: note.id,
        content,
        contentHash: hash,
        createdAt: note.createdAt,
        createdBy: 'user'
      });
    }
    const insert = db.prepare('INSERT OR REPLACE INTO sync_base VALUES (?, ?, ?, ?)');
    for (const [collection, items] of Object.entries(state))
      for (const value of items) insert.run(collection, value.id, 1, JSON.stringify(value));
    for (const [key, value] of Object.entries({
      serverUrl: 'http://localhost',
      epoch,
      cursor,
      lastSyncedAt: '2026-09-30T00:00:00.000Z'
    }))
      writeMeta(db, key, value);
  });
  let requests = 0;
  engine = createSyncEngine(store, {
    autoSync: false,
    entityTransfer: {},
    fetcher: async url => {
      requests++;
      const data = url.endsWith('/status')
        ? { protocolVersion: 1, scope: 'notes', ...syncContract(), ownerId: 'demo', datasetEpoch: epoch }
        : url.includes('/device?')
          ? { sequence: 0 }
          : { ...syncContract(), ownerId: 'demo', groups: [], cursor, datasetEpoch: epoch, hasMore: false };
      return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  await engine.sync();
  engine.status();
  if (engine.status().error) throw new Error(JSON.stringify(engine.status().error));
  const rows = () => store.readSync(db => db.prepare('SELECT total_changes() AS count').get().count);
  const beforeRows = rows();
  const beforeGeneration = engine.status().generation;
  const beforeCpu = process.cpuUsage();
  const beforeUsage = process.resourceUsage();
  requests = 0;
  let polls = 0;
  let cycles = 0;
  const started = performance.now();
  const samples = [];
  const cycleMs = Number(process.env.KNOWRA_IDLE_CYCLE_MS ?? 15000);
  const pollMs = Number(process.env.KNOWRA_IDLE_POLL_MS ?? 2000);
  let nextCycle = started + cycleMs;
  let nextPoll = started + pollMs;
  while (performance.now() - started < durationMs) {
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(1, Math.min(nextCycle, nextPoll, started + durationMs) - performance.now()))
    );
    if (performance.now() >= nextCycle) {
      await engine.sync();
      cycles++;
      nextCycle = performance.now() + cycleMs;
    }
    if (performance.now() >= nextPoll) {
      engine.status();
      polls++;
      nextPoll = performance.now() + pollMs;
      samples.push(process.memoryUsage().rss);
    }
  }
  const cpu = process.cpuUsage(beforeCpu);
  const usage = process.resourceUsage();
  const result = {
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    node: process.version,
    notes: count,
    baselineRows: count * 2 + 1,
    durationMs: performance.now() - started,
    cycleMs,
    pollMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    cycles,
    polls,
    requests,
    changedRows: rows() - beforeRows,
    generationDelta: engine.status().generation - beforeGeneration,
    peakSampledRssBytes: Math.max(...samples),
    firstRssBytes: samples[0],
    finalRssBytes: samples.at(-1),
    fsWriteDelta: usage.fsWrite - beforeUsage.fsWrite,
    network: '模拟空云端响应，仅测本机运行时；不包含真实网络或 Electron 界面'
  };
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await engine?.close();
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
}
