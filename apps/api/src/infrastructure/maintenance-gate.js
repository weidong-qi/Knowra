import { getKnowledgeOperationAccess } from './knowledge-operation-access.js';

export function createMaintenanceGate() {
  let activeOperations = 0;
  let maintenanceActive = false;
  let waitingMaintenances = 0;
  let maintenanceTail = Promise.resolve();
  let mutationTail = Promise.resolve();
  const waiters = new Set();

  function notifyWaiters() {
    for (const resolve of waiters) resolve();
    waiters.clear();
  }

  async function waitUntil(predicate) {
    while (!predicate()) {
      await new Promise(resolve => waiters.add(resolve));
    }
  }

  return {
    async runOperation(operation) {
      await waitUntil(() => !maintenanceActive && waitingMaintenances === 0);
      activeOperations += 1;
      try {
        return await operation();
      } finally {
        activeOperations -= 1;
        notifyWaiters();
      }
    },

    async runMaintenance(operation) {
      let releaseMaintenance;
      const previousMaintenance = maintenanceTail;
      maintenanceTail = new Promise(resolve => {
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

    async runMutation(operation) {
      let releaseMutation;
      const previousMutation = mutationTail;
      mutationTail = new Promise(resolve => {
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

/**
 * @template {object} T
 * @typedef {{[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K]}} GatedHandlers
 */
/**
 * @template {object} T
 * @param {T} handlers
 * @param {ReturnType<typeof createMaintenanceGate>} maintenanceGate
 * @returns {GatedHandlers<T>}
 */
export function wrapHandlersWithMaintenanceGate(
  handlers,
  maintenanceGate,
  /** @type {{getAccess?: ((name: string) => unknown) | undefined}} */
  { getAccess = getKnowledgeOperationAccess } = {}
) {
  return /** @type {GatedHandlers<T>} */ (
    Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => {
        if (typeof handler !== 'function') return [name, handler];
        const access = getAccess(name);
        return [
          name,
          (...args) =>
            access === 'mutation'
              ? maintenanceGate.runMutation(() => handler(...args))
              : maintenanceGate.runOperation(() => handler(...args))
        ];
      })
    )
  );
}
