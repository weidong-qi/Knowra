import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  budgetStatus,
  pruneBudgetState,
  reserveBudget,
  settleBudget,
  usageRows,
  usageSummary,
  validateBudgetState
} from '../../api/src/modules/ai/budget-ledger.ts';

const unavailable = (message, cause) =>
  Object.assign(new Error(message), { code: 'AI_BUDGET_UNAVAILABLE', ...(cause ? { cause } : {}) });

/**
 * Mac 应用的本机预算账本：模型调用不再依赖云端预算服务，断开云端也能使用。
 * 预算规则与云端完全一致（复用同一份纯逻辑：北京时间每日 20 元、单任务 2 元、预留—结算、未知费用继续占用预算）。
 * 账本是数据目录根下的一个文件，不随“恢复备份”切换的资料目录重置；写盘成功后才生效，任何失败都拒绝付费调用（fail closed）。
 * 取舍：额度按设备各自计算，多台设备同时使用时合计可能超过 20 元；账本由本机用户持有，只防误用，不是安全边界。
 */
export function createLocalBudgetAuthority({ filePath } = {}) {
  if (!path.isAbsolute(filePath ?? '')) throw new TypeError('本机预算账本需要绝对路径。');
  let state = null,
    failure = null,
    queue = Promise.resolve();

  function load() {
    if (state || failure) return;
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        state = { budgetDays: [], budgetReservations: [], budgetMonths: [] };
        return;
      }
      failure = unavailable('本机预算账本无法读取，已阻止模型调用；原文件已保留。', error);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      // 顶层必须是普通对象：数组、null 等会被校验函数“补全”成看似合法的空账本，等于清零预算。
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.keys(parsed).some(key => !['budgetDays', 'budgetReservations', 'budgetMonths'].includes(key)) ||
        // 两个集合必须都存在且是数组：共享校验函数会把缺失或 null 补成空数组，等于额度清零并在下次写盘时覆盖原文件。
        !Array.isArray(parsed.budgetDays) ||
        !Array.isArray(parsed.budgetReservations) ||
        // 月汇总是折叠后历史费用的唯一记录：只有字段缺失（旧版本文件）才视为空，显式 null 或其他类型是损坏。
        (parsed.budgetMonths !== undefined && !Array.isArray(parsed.budgetMonths))
      )
        throw new Error('预算账本结构无效。');
      state = validateBudgetState(parsed);
    } catch (error) {
      failure = unavailable('本机预算账本已损坏，已阻止模型调用；原文件已保留，请修复或备份后重试。', error);
    }
  }
  function persist(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({
            budgetDays: next.budgetDays,
            budgetReservations: next.budgetReservations,
            budgetMonths: next.budgetMonths
          })
        );
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, filePath);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  // 在副本上计算、写盘成功后才替换内存状态：计算中途失败或写盘失败都不留下半成品。回调本身是同步的，天然不会交错；队列保证以后即使改成异步写盘，变更仍依次执行。
  function transact(change) {
    const run = queue.then(() => {
      load();
      if (failure) throw failure;
      const draft = structuredClone(state);
      const result = change(draft);
      try {
        persist(draft);
      } catch (error) {
        throw unavailable('本机预算账本写入失败，已阻止模型调用。', error);
      }
      state = draft;
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }
  return {
    async status(accountRef, date, limits) {
      await queue;
      load();
      if (failure) throw failure;
      return budgetStatus(state, accountRef, date, limits);
    },
    async usage(accountRef, date) {
      await queue;
      load();
      if (failure) throw failure;
      return usageSummary(state, accountRef, date);
    },
    reserve: input => transact(draft => reserveBudget(draft, input)),
    async usageRows(accountRef) {
      await queue;
      load();
      if (failure) throw failure;
      return usageRows(state, accountRef);
    },
    settle: input =>
      transact(draft => {
        const result = settleBudget(draft, input);
        pruneBudgetState(draft, input.accountRef);
        return result;
      })
  };
}
