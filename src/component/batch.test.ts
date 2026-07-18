import { describe, expect, test } from "vitest";
import { parseBatchResponse, runtimeConfigKey } from "./batch.js";
import type { RuntimeConfig } from "./shared.js";

const options: RuntimeConfig = {
  baseUrl: "https://app.usesend.com",
  initialBackoffMs: 30_000,
  retryAttempts: 5,
  requestTimeoutMs: 30_000,
};

describe("runtimeConfigKey", () => {
  test("is stable and contains no secret material", () => {
    const key = runtimeConfigKey(options);

    expect(runtimeConfigKey(options)).toBe(key);
    expect(runtimeConfigKey({ ...options, retryAttempts: 6 })).not.toBe(key);
  });

  test("ignores a legacy stored apiKey field when grouping", () => {
    const legacyOptions = {
      ...options,
      apiKey: "legacy-secret-api-key",
    } as RuntimeConfig;

    expect(runtimeConfigKey(legacyOptions)).toBe(runtimeConfigKey(options));
    expect(runtimeConfigKey(legacyOptions)).not.toContain(
      "legacy-secret-api-key",
    );
  });
});

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
