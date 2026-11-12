import type {
  PrivateSqlClient,
  PrivateSqlTransaction,
  StoreSqlValue,
  AiSqlError,
  BudgetDayRow,
  BudgetReservationRow,
  BudgetReservation,
  BudgetState,
  BudgetLimits,
  BudgetReserveInput,
  BudgetSettlement
} from './private-store-types.ts';
import { beijingDay, budgetStatus, reserveBudget, settleBudget, usageRows, usageSummary } from './budget-ledger.ts';

const retryable = (error: AiSqlError | null | undefined) =>
  ['P2034', '23505', '40001'].includes(error?.code as string) ||
  ['23505', '40001'].includes(error?.meta?.code as string);
const read = <Row>(db: PrivateSqlTransaction, sql: string, ...values: StoreSqlValue[]) =>
  db.$queryRawUnsafe<Row[]>(sql, ...values);
const write = (db: PrivateSqlTransaction, sql: string, ...values: StoreSqlValue[]) =>
  db.$executeRawUnsafe(sql, ...values);
// 明细损坏（无法解析）按未记录处理，不能让用量查询或结算整体失败。
function parseUsage(text: string | null | undefined): object | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const convert = (row: BudgetReservationRow): BudgetReservation => ({
  reservationId: row.reservation_id,
  accountRef: row.account_ref,
  day: row.beijing_day,
  jobId: row.job_id,
  attemptId: row.attempt_id,
  priceVersion: row.price_version,
  reservedMicrounits: Number(row.reserved_microunits),
  actualMicrounits: row.actual_microunits === null ? null : Number(row.actual_microunits),
  status: row.status,
  createdAt: row.created_at,
  settledAt: row.settled_at,
  ...(parseUsage(row.usage_detail) ? { usage: parseUsage(row.usage_detail) } : {})
});

/** 计费账户全局串行化；同一账户跨 owner、资料集及设备共用日额度。 */
export function createPostgresBudgetAuthority(client: PrivateSqlClient) {
  if (!client?.$transaction) throw new TypeError('PostgreSQL budget authority needs a Prisma client');
  async function transact<Result>(accountRef: string | undefined, operation: (state: BudgetState) => Result) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await client.$transaction(
          async db => {
            await read(db, 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked', accountRef);
            const days = await read<BudgetDayRow>(
              db,
              'SELECT * FROM ai_budget_days WHERE account_ref = $1',
              accountRef
            );
            const reservations = await read<BudgetReservationRow>(
              db,
              'SELECT * FROM ai_budget_reservations WHERE account_ref = $1',
              accountRef
            );
            const state = {
              budgetDays: days.map(row => ({
                accountRef: row.account_ref,
                day: row.beijing_day,
                spentMicrounits: Number(row.spent_microunits),
                heldMicrounits: Number(row.held_microunits)
              })),
              budgetReservations: reservations.map(convert)
            };
            const before = new Set(state.budgetReservations.map(row => row.reservationId));
            const result = operation(state);
            for (const day of state.budgetDays) {
              await write(
                db,
                `INSERT INTO ai_budget_days (account_ref, beijing_day, spent_microunits, held_microunits)
              VALUES ($1, $2, $3, $4) ON CONFLICT (account_ref, beijing_day) DO UPDATE
              SET spent_microunits = EXCLUDED.spent_microunits, held_microunits = EXCLUDED.held_microunits`,
                day.accountRef,
                day.day,
                BigInt(day.spentMicrounits),
                BigInt(day.heldMicrounits)
              );
            }
            for (const row of state.budgetReservations) {
              if (!before.has(row.reservationId))
                await write(
                  db,
                  `INSERT INTO ai_budget_reservations
              (reservation_id, account_ref, beijing_day, job_id, attempt_id, price_version, reserved_microunits,
               actual_microunits, status, created_at, settled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                  row.reservationId,
                  row.accountRef,
                  row.day,
                  row.jobId,
                  row.attemptId,
                  row.priceVersion,
                  BigInt(row.reservedMicrounits),
                  null,
                  row.status,
                  row.createdAt,
                  null
                );
              else {
                const previous = reservations.find(item => item.reservation_id === row.reservationId)!;
                if (previous.status !== row.status)
                  await write(
                    db,
                    `UPDATE ai_budget_reservations
                SET status = $1, actual_microunits = $2, settled_at = $3, usage_detail = $4 WHERE reservation_id = $5`,
                    row.status,
                    row.actualMicrounits === null ? null : BigInt(row.actualMicrounits),
                    row.settledAt,
                    row.usage ? JSON.stringify(row.usage) : null,
                    row.reservationId
                  );
              }
            }
            return result;
          },
          { isolationLevel: 'ReadCommitted', maxWait: 15000, timeout: 15000 }
        );
      } catch (error) {
        if (!retryable(error as AiSqlError | null | undefined) || attempt === 4) throw error;
      }
    }
  }
  return {
    async status(accountRef: string, day = beijingDay(), limits?: BudgetLimits) {
      const rows = await read<BudgetDayRow>(
        client,
        'SELECT beijing_day, spent_microunits, held_microunits FROM ai_budget_days WHERE account_ref = $1 AND beijing_day LIKE $2',
        accountRef,
        `${day.slice(0, 7)}-%`
      );
      return budgetStatus(
        {
          budgetDays: rows.map(row => ({
            accountRef,
            day: row.beijing_day,
            spentMicrounits: Number(row.spent_microunits),
            heldMicrounits: Number(row.held_microunits)
          }))
        },
        accountRef,
        day,
        limits
      );
    },
    async usage(accountRef: string, day = beijingDay()) {
      const reservations = await read<BudgetReservationRow>(
        client,
        `SELECT * FROM ai_budget_reservations WHERE account_ref = $1
        AND status IN ('settled','unknown') ORDER BY created_at DESC`,
        accountRef
      );
      // PostgreSQL 目前不折叠明细，所以没有月汇总，日账本也无需读取。
      return usageSummary(
        { budgetDays: [], budgetReservations: reservations.map(convert), budgetMonths: [] },
        accountRef,
        day
      );
    },
    async usageRows(accountRef: string) {
      const reservations = await read<BudgetReservationRow>(
        client,
        `SELECT * FROM ai_budget_reservations WHERE account_ref = $1
        AND status IN ('settled','unknown') ORDER BY created_at ASC`,
        accountRef
      );
      return usageRows({ budgetDays: [], budgetReservations: reservations.map(convert), budgetMonths: [] }, accountRef);
    },
    reserve: (input: BudgetReserveInput) =>
      transact(input.accountRef, state => reserveBudget(state, { ...input, day: beijingDay() })),
    settle: (input: BudgetSettlement) => transact(input.accountRef, state => settleBudget(state, input))
  };
}
