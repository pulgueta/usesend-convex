/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workpoolTest from "@convex-dev/workpool/test";
import schema from "./component/schema.js";
const modules = import.meta.glob([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
  "!./component/**/*.setup.ts",
]);

/**
 * Register the component with the test convex instance.
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The name of the component, as registered in convex.config.ts.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "usesend",
) {
  t.registerComponent(name, schema, modules);
  rateLimiterTest.register(t, `${name}/rateLimiter`);
  workpoolTest.register(t, `${name}/emailWorkpool`);
  workpoolTest.register(t, `${name}/callbackWorkpool`);
}
export default { register, schema, modules };
