import { parse } from "convex-helpers/validators";
import type { Infer, Validator } from "convex/values";

export function assertExhaustive(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}

export function attemptToParse<
  T extends Validator<unknown, "required", string>,
>(
  validator: T,
  value: unknown,
): { kind: "success"; data: Infer<T> } | { kind: "error"; error: string } {
  try {
    // Strips unknown fields, throws on missing/mismatched ones.
    return { kind: "success", data: parse(validator, value) };
  } catch (e) {
    return { kind: "error", error: String(e) };
  }
}
