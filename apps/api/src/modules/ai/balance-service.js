import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ENDPOINT = 'https://api.deepseek.com/user/balance';
const KEEP_MS = 90 * 24 * 3600_000;
const MAX_SNAPSHOTS = 2000;
// 余额没变化时，短时间内的重复读取不重复保存，避免打开设置页就刷出一串快照。
const DEDUPE_MS = 10 * 60_000;
const CURRENCIES = new Set(['CNY', 'USD']);

const failure = (code, message) => Object.assign(new Error(message), { code });

/** DeepSeek 以字符串返回金额（如 "110.00"）；按十进制文本换算成百万分之一元，避免浮点误差。 */
export function parseMicrounits(text) {
  if (typeof text !== 'string' || !/^\d{1,12}(\.\d{1,8})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0').slice(0, 6));
}

export function normalizeBalance(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.is_available !== 'boolean' ||
    !Array.isArray(body.balance_infos)
  ) {
    throw failure('AI_BALANCE_INVALID', 'DeepSeek 返回的余额格式无效。');
  }
  const balances = body.balance_infos.map(item => {
    const total = parseMicrounits(item?.total_balance);
    const granted = parseMicrounits(item?.granted_balance);
    const toppedUp = parseMicrounits(item?.topped_up_balance);
    if (!CURRENCIES.has(item?.currency) || total === null || granted === null || toppedUp === null) {
      throw failure('AI_BALANCE_INVALID', 'DeepSeek 返回的余额格式无效。');
    }
    return {
      currency: item.currency,
      totalMicrounits: total,
      grantedMicrounits: granted,
      toppedUpMicrounits: toppedUp
    };
  });
  return { isAvailable: body.is_available, balances };
}

export async function fetchDeepSeekBalance({ apiKey, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'GET',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw failure('AI_BALANCE_UNAVAILABLE', '无法连接 DeepSeek，请检查网络后重试。');
  }
  if (response.status === 401 || response.status === 403)
    throw failure('AI_BALANCE_REJECTED', 'DeepSeek 拒绝了 API Key，无法读取余额。');
  if (response.status === 429) throw failure('AI_BALANCE_UNAVAILABLE', 'DeepSeek 请求过于频繁，请稍后重试。');
  if (!response.ok) throw failure('AI_BALANCE_UNAVAILABLE', 'DeepSeek 暂时无法返回余额。');
  let body;
  try {
    body = await response.json();
  } catch {
    throw failure('AI_BALANCE_INVALID', 'DeepSeek 返回的余额格式无效。');
  }
  return normalizeBalance(body);
}

/**
 * 按币种用相邻快照的差值推算账户总消耗：余额下降计为消耗，上升视为充值或赠送。
 * 两次快照之间同时发生充值与消耗时，消耗会被低估；同一 Key 在别处使用的消耗也会计入，所以只是推算。
 */
export function inferConsumption(snapshots) {
  const result = new Map();
  let previous = null;
  for (const snapshot of snapshots) {
    for (const row of snapshot.balances) {
      const item = result.get(row.currency) ?? {
        currency: row.currency,
        sinceAt: snapshot.at,
        snapshots: 0,
        consumedMicrounits: 0,
        addedMicrounits: 0,
        currentMicrounits: 0
      };
      const before = previous?.balances.find(entry => entry.currency === row.currency);
      if (before) {
        const delta = row.totalMicrounits - before.totalMicrounits;
        if (delta < 0) item.consumedMicrounits -= delta;
        else item.addedMicrounits += delta;
      }
      item.snapshots += 1;
      item.currentMicrounits = row.totalMicrounits;
      result.set(row.currency, item);
    }
    previous = snapshot;
  }
  return [...result.values()];
}

function validSnapshots(value) {
  return (
    Array.isArray(value) &&
    value.every(
      item =>
        item &&
        typeof item.at === 'string' &&
        typeof item.credentialRef === 'string' &&
        item.credentialRef.length > 0 &&
        Number.isFinite(Date.parse(item.at)) &&
        typeof item.isAvailable === 'boolean' &&
        Array.isArray(item.balances) &&
        item.balances.every(
          row =>
            CURRENCIES.has(row.currency) &&
            [row.totalMicrounits, row.grantedMicrounits, row.toppedUpMicrounits].every(
              n => Number.isSafeInteger(n) && n >= 0
            )
        )
    )
  );
}

/**
 * 余额读取 + 快照。快照文件只含时间、金额和凭据代际（随机 ID，不含密钥或对话内容）；读取失败不影响任何 AI 调用。
 * 每条快照绑定保存时的凭据代际：更换账户（换 API Key）后旧快照不再参与展示与推算，避免把 A 账户的余额当成 B 账户的。
 * 文件损坏时拒绝推算并保留原文件，由用户处理，而不是静默重置历史。
 */
export function createBalanceService({
  credentialReference,
  resolveCredential,
  filePath,
  fetchImpl = fetch,
  now = () => new Date()
}) {
  if (!path.isAbsolute(filePath ?? '')) throw new TypeError('余额快照需要绝对路径。');
  let queue = Promise.resolve();

  async function load() {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw failure('AI_BALANCE_STORAGE_INVALID', '余额快照无法读取。');
    }
    try {
      const parsed = JSON.parse(raw);
      if (!validSnapshots(parsed?.snapshots)) throw new Error('invalid');
      return parsed.snapshots;
    } catch {
      throw failure('AI_BALANCE_STORAGE_INVALID', '余额快照文件已损坏，原文件已保留。');
    }
  }
  async function save(snapshots) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify({ snapshots }), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, filePath);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }
  /** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
  const serial = work => {
    const run = queue.then(work);
    queue = run.catch(() => undefined);
    return run;
  };

  const view = (all, ref, live = null) => {
    const snapshots = all.filter(item => item.credentialRef === ref);
    const latest = snapshots.at(-1) ?? null;
    return { latest: live ?? latest, checkedAt: latest?.at ?? null, inferred: inferConsumption(snapshots) };
  };

  return {
    /** 只读已保存的快照，不联网。 */
    view: () => serial(async () => view(await load(), (await credentialReference())?.credentialRef ?? null)),
    /** 联网读取实时余额并追加快照；快照写入失败时仍返回实时余额，但标明未保存。 */
    refresh: () =>
      serial(async () => {
        const all = await load();
        const reference = await credentialReference();
        if (!reference) throw failure('AI_NOT_CONFIGURED', '请先在设置中配置模型。');
        const ref = reference.credentialRef;
        const snapshots = all.filter(item => item.credentialRef === ref);
        const { apiKey } = await resolveCredential(reference.credentialRef);
        const live = await fetchDeepSeekBalance({ apiKey, fetchImpl });
        // 读取期间若已更换 Key，这份响应属于旧账户：丢弃，不展示，请用户重新读取。保存之后返回之前还要再核对一次。
        const assertCurrent = async () => {
          if ((await credentialReference())?.credentialRef !== ref) {
            throw failure('AI_BALANCE_STALE', '账户凭据在读取期间已变更，已丢弃过期的余额响应，请重新读取。');
          }
        };
        await assertCurrent();
        const at = now();
        const entry = { at: at.toISOString(), credentialRef: ref, ...live };
        const last = snapshots.at(-1);
        const same =
          last &&
          last.isAvailable === live.isAvailable &&
          JSON.stringify(last.balances) === JSON.stringify(live.balances);
        if (same && at.getTime() - Date.parse(last.at) < DEDUPE_MS) return view(all, ref, entry);
        // 其他凭据代际的旧快照随期限自然清理，不参与当前账户的推算。
        const kept = [...all, entry]
          .filter(item => at.getTime() - Date.parse(item.at) <= KEEP_MS)
          .slice(-MAX_SNAPSHOTS);
        let saved = true;
        try {
          await save(kept);
        } catch {
          saved = false;
        }
        // 异步写盘期间也可能换 Key；快照本身带着 A 的代际标记，不会混入 B，但返回给页面的视图必须属于当前账户。
        await assertCurrent();
        return saved ? view(kept, ref) : { ...view(all, ref, entry), saved: false };
      })
  };
}
