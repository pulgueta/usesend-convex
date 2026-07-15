import type { RuntimeConfig } from "./shared.js";

export function runtimeConfigKey(options: RuntimeConfig) {
  return JSON.stringify([
    options.apiKey,
    options.baseUrl,
    options.initialBackoffMs,
    options.retryAttempts,
    options.requestTimeoutMs,
    options.onEmailEvent?.fnHandle,
  ]);
}

export function parseBatchResponse(value: unknown, expectedCount: number) {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new Error("Invalid useSend batch response: missing data array");
  }
  const data = value.data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid useSend batch response: data is not an array");
  }
  const emailIds = data.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("emailId" in entry) ||
      typeof entry.emailId !== "string"
    ) {
      throw new Error(
        `Invalid useSend batch response: missing email ID at index ${index}`,
      );
    }
    return entry.emailId;
  });
  if (emailIds.length !== expectedCount) {
    throw new Error(
      `Invalid useSend batch response: expected ${expectedCount} email IDs, received ${emailIds.length}`,
    );
  }
  if (emailIds.some((emailId) => emailId.length === 0)) {
    throw new Error(
      "Invalid useSend batch response: received an empty email ID",
    );
  }
  if (new Set(emailIds).size !== emailIds.length) {
    throw new Error(
      "Invalid useSend batch response: received duplicate email IDs",
    );
  }
  return emailIds;
}
