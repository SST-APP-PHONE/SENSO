import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { "import.meta.env.BASE_URL": JSON.stringify("/senso/") },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["tests/server/**/*.test.ts"],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
