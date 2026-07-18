/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "./schema.js";
import component from "@pulgueta/usesend-convex/test";
import { components as generatedComponents } from "./_generated/api.js";

const modules = import.meta.glob([
  "./**/*.{ts,tsx}",
  "!./**/*.test.{ts,tsx}",
  "!./**/*.setup.{ts,tsx}",
]);
// When users want to write tests that use your component, they need to
// explicitly register it with its schema and modules.
export function initConvexTest() {
  const t = convexTest(schema, modules);
  component.register(t);
  return t;
}

export const components = generatedComponents;
