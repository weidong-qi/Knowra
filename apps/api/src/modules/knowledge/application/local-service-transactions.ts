// Local services only mutate model state. File cleanup belongs to coordinators
// after their transaction commits, never inside this wrapper.
export function bindLocalServiceTransactions<Service extends object>(
  service: Service,
  runTransaction: <Result>(operation: () => Result) => Result,
  readOnlyMethods?: Iterable<string> | null
) {
  type Operation = (...args: never[]) => ReturnType<Extract<Service[keyof Service], (...args: never[]) => void>>;
  const readOnly = new Set(readOnlyMethods);
  for (const [name, operation] of Object.entries(service)) {
    if (typeof operation !== 'function' || readOnly.has(name)) continue;
    (service as Record<string, Operation>)[name] = (...args) =>
      runTransaction(() => (operation as Operation).apply(service, args));
  }
  return service;
}
