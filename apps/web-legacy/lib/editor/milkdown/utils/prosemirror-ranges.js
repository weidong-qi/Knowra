export function findAncestorOfType($pos, typeNames) {
  const names = typeNames instanceof Set ? typeNames : new Set(typeNames);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (names.has(node.type.name)) {
      return {
        depth,
        node,
        pos: $pos.before(depth)
      };
    }
  }

  return null;
}

