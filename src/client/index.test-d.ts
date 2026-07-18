import { describe, expectTypeOf, test } from "vitest";
import type {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { UseSend } from "./index.js";

// Regression tests for https://github.com/pulgueta/usesend-convex/issues/3:
// every documented context kind must satisfy the client's ctx parameters.
describe("context type compatibility", () => {
  type QueryCtx = GenericQueryCtx<GenericDataModel>;
  type MutationCtx = GenericMutationCtx<GenericDataModel>;
  type ActionCtx = GenericActionCtx<GenericDataModel>;
  type ReadCtx = Parameters<UseSend["status"]>[0];
  type WriteCtx = Parameters<UseSend["sendEmail"]>[0];

  test("get and status accept query, mutation, and action contexts", () => {
    expectTypeOf<QueryCtx>().toExtend<ReadCtx>();
    expectTypeOf<MutationCtx>().toExtend<ReadCtx>();
    expectTypeOf<ActionCtx>().toExtend<ReadCtx>();
  });

  test("mutation methods accept mutation and action contexts", () => {
    expectTypeOf<MutationCtx>().toExtend<WriteCtx>();
    expectTypeOf<ActionCtx>().toExtend<WriteCtx>();
  });
});
