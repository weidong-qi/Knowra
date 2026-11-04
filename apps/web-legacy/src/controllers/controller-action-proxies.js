function findControllerMethod(controllers, methodName) {
  return Object.values(controllers).find((controller) => (
    controller && typeof controller[methodName] === 'function'
  ));
}

export function createControllerActionProxies(getControllers) {
  const cache = new Map();

  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') {
        return undefined;
      }
      if (!cache.has(property)) {
        cache.set(property, (...args) => {
          const controller = findControllerMethod(getControllers(), property);
          if (!controller) {
            throw new Error(`Controller action is not registered: ${property}`);
          }
          return controller[property](...args);
        });
      }
      return cache.get(property);
    }
  });
}
