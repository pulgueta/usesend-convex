import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  test("usesend component is initialized", async () => {
    // The usesend component should be properly initialized
    // We can't fully test email sending without mocking the API,
    // but we can verify the component structure exists
    expect(api.example.sendTestEmail).toBeDefined();
    expect(api.example.sendTemplatedEmail).toBeDefined();
    expect(api.example.getEmailStatus).toBeDefined();
    expect(api.example.cancelEmail).toBeDefined();
    expect(internal.example.handleEmailEvent).toBeDefined();
  });
});
