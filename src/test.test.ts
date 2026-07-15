import { describe, expect, test } from "vitest";
import testHelpers from "./test.js";

describe("component test helpers", () => {
  test("exclude the package's test modules from consumer registration", () => {
    expect(
      Object.keys(testHelpers.modules).every(
        (path) => !path.endsWith(".test.ts"),
      ),
    ).toBe(true);
  });
});
