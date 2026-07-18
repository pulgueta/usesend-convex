import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/_generated/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.setup.{ts,tsx}",
        "src/react/index.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
