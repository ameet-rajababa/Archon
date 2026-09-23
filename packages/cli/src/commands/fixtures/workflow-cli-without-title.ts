import { mock } from 'bun:test';

// Keep the public CLI, its detached forwarding, and execution real. Title generation
// is unrelated background AI work, so deterministic CLI fixtures suppress only it.
//
// A module mock REPLACES the module, so this has to name every export the real
// one has: an importer of a name missing here fails to link with "Export named
// 'x' not found", which surfaces as the CLI refusing to start rather than as
// anything about titles. Adding an export to title-generator means adding its
// no-op here.
mock.module('@archon/core/services/title-generator', () => ({
  generateAndSetTitle: async (): Promise<void> => undefined,
  reconsiderConversationTitle: async (): Promise<void> => undefined,
}));

await import('../../cli');
