import { getKnowledgeOperationAccess } from './knowledge-operation-access.ts';
import type { KnowledgeOperationAccess } from './knowledge-operation-access.ts';

export type GatedHandlers<Handlers extends object> = {
  [Key in keyof Handlers]: Handlers[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : Handlers[Key];
};

export interface MaintenanceHandlerOptions {
  getAccess?: (name: string) => KnowledgeOperationAccess;
}

export type HandlerResult<Handlers extends object> = ReturnType<
  Extract<Handlers[keyof Handlers], (...args: never[]) => void>
>;

export function createMaintenanceGate() {
  let activeOperations = 0;
  let maintenanceActive = false;
  let waitingMaintenances = 0;
  let maintenanceTail = Promise.resolve();
  let mutationTail = Promise.resolve();
  const waiters = new Set<() => void>();

  function notifyWaiters() {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }

  async function waitUntil(predicate: () => boolean) {
    while (!predicate()) {
      await new Promise<void>(resolve => waiters.add(resolve));
    }
  }

  return {
    async runOperation<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> {
      await waitUntil(() => !maintenanceActive && waitingMaintenances === 0);
      activeOperations += 1;
      try {
        return await operation();
      } finally {
        activeOperations -= 1;
        notifyWaiters();
      }
    },

    async runMaintenance<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> {
      let releaseMaintenance!: () => void;
      const previousMaintenance = maintenanceTail;
      maintenanceTail = new Promise<void>(resolve => {
        releaseMaintenance = resolve;
      });
      waitingMaintenances += 1;
      let stillWaiting = true;
      try {
        await previousMaintenance;
        await waitUntil(() => !maintenanceActive && activeOperations === 0);
        waitingMaintenances -= 1;
        stillWaiting = false;
        maintenanceActive = true;
        try {
          return await operation();
        } finally {
          maintenanceActive = false;
          notifyWaiters();
        }
      } finally {
        if (stillWaiting) waitingMaintenances -= 1;
        releaseMaintenance();
        notifyWaiters();
      }
    },

    async runMutation<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> {
      let releaseMutation!: () => void;
      const previousMutation = mutationTail;
      mutationTail = new Promise<void>(resolve => {
        releaseMutation = resolve;
      });
      await previousMutation;
      try {
        return await this.runOperation(operation);
      } finally {
        releaseMutation();
      }
    },

    getState() {
      return {
        activeOperations,
        maintenanceActive,
        waitingMaintenances
      };
    }
  };
}

export function wrapHandlersWithMaintenanceGate<Handlers extends object>(
  handlers: Handlers,
  maintenanceGate: ReturnType<typeof createMaintenanceGate>,
  { getAccess = getKnowledgeOperationAccess }: MaintenanceHandlerOptions = {}
): GatedHandlers<Handlers> {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => {
      if (typeof handler !== 'function') return [name, handler];
      const access = getAccess(name);
      return [
        name,
        (...args: never[]) =>
          access === 'mutation'
            ? maintenanceGate.runMutation(() => (handler as (...args: never[]) => HandlerResult<Handlers>)(...args))
            : maintenanceGate.runOperation(() => (handler as (...args: never[]) => HandlerResult<Handlers>)(...args))
      ];
    })
  ) as GatedHandlers<Handlers>;
}
