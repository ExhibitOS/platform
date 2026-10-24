// Keep Three core in its own explicit group. Rolldown does not pass its internal
// runtime to group matchers; isolating the core leaves shared interop independent.
// Do not capture addons or their dependencies: their existing lazy loading stays intact.
export const rendererIndependentChunks = {
  groups: [{ name: 'three-renderer', test: /node_modules[\\/]three[\\/]build[\\/]/, includeDependenciesRecursively: false, priority: 100 }],
};
