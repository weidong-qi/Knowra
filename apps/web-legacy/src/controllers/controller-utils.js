export function createRequiredDependencyGetter(deps, controllerName) {
  return function getDependency(key) {
    if (!deps || !(key in deps)) {
      throw new Error(`${controllerName} missing dependency: ${key}`);
    }
    return deps[key];
  };
}
