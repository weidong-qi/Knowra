/** 事务宿主只向下游仓库传递事务对象，不依赖 Prisma 生成模型。 */
export interface PostgresTransactionHost<Transaction extends object = object> {
  $transaction<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
    options?: {
      isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
      maxWait?: number;
      timeout?: number;
    }
  ): Promise<Result>;
}
