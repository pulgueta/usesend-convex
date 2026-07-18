/// <reference types="vite/client" />
import schema from "./schema.js";
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workpoolTest from "@convex-dev/workpool/test";
export const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "!./**/*.setup.ts",
]);

export function initConvexTest() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiter");
  workpoolTest.register(t, "emailWorkpool");
  workpoolTest.register(t, "callbackWorkpool");
  return t;
}
