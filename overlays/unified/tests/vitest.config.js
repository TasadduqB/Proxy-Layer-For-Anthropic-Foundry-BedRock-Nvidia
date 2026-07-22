import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/dist/**",
      // The pinned repository contains this test but explicitly omits the
      // proprietary cloud/ Worker source it imports (see upstream CLAUDE.md).
      "**/tests/unit/embeddings.cloud.test.js",
    ],
    setupFiles: [resolve(__dirname, "setup/no-network.js")],
    // Large provider registries are transformed on first import. Under the
    // exhaustive parallel suite that cold import can exceed Vitest's 5s
    // default even though the same test completes immediately afterward.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
