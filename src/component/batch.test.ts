import { describe, expect, test } from "vitest";
import { parseBatchResponse } from "./batch.js";

describe("parseBatchResponse", () => {
  test("accepts required IDs with additional provider metadata", () => {
    expect(
      parseBatchResponse(
        {
          data: [{ emailId: "usesend_1", status: "queued" }],
          requestId: "request_1",
        },
        1,
      ),
    ).toEqual(["usesend_1"]);
  });

  test("rejects missing or malformed data", () => {
    expect(() => parseBatchResponse({}, 1)).toThrow("missing data array");
    expect(() => parseBatchResponse({ data: [{}] }, 1)).toThrow(
      "missing email ID at index 0",
    );
  });

  test("rejects empty and duplicate IDs", () => {
    expect(() => parseBatchResponse({ data: [{ emailId: "" }] }, 1)).toThrow(
      "empty email ID",
    );
    expect(() =>
      parseBatchResponse(
        { data: [{ emailId: "same" }, { emailId: "same" }] },
        2,
      ),
    ).toThrow("duplicate email IDs");
  });
});
