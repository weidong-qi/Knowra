import type { BudgetReserveInput, BudgetSettlement } from './private-store-types.ts';
interface RemoteBudgetRequest<Result> {
  (operation: 'status' | 'reserve' | 'settle', input?: BudgetReserveInput | BudgetSettlement): Result;
}
/** Mac 只向云端预算权威申请额度；断网、停用同步和响应不完整均拒绝付费执行。 */
export function createRemoteBudgetAuthority<Result>(request: RemoteBudgetRequest<Result>) {
  if (typeof request !== 'function') throw new TypeError('Remote budget request is required');
  return {
    status: () => request('status'),
    reserve: (input: BudgetReserveInput) => request('reserve', input),
    settle: (input: BudgetSettlement) => request('settle', input)
  };
}
