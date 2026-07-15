import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { initConvexTest } from "./setup.test";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

  test("rejects unauthenticated email operations", async () => {
    const t = initConvexTest();

    await expect(t.mutation(api.example.sendTestEmail)).rejects.toThrow(
      "Administrator access required",
    );
    await expect(
      t.query(api.example.getEmailStatus, { emailId: "email_123" }),
    ).rejects.toThrow("Administrator access required");
    await expect(
      t.mutation(api.example.cancelEmail, { emailId: "email_123" }),
    ).rejects.toThrow("Administrator access required");
  });

  test("rejects unauthenticated REST API operations", async () => {
    const t = initConvexTest();

    await expect(t.action(api.example.listDomains)).rejects.toThrow(
      "Administrator access required",
    );
    await expect(
      t.action(api.example.subscribeContact, {
        contactBookId: "book_123",
        email: "recipient@example.com",
      }),
    ).rejects.toThrow("Administrator access required");
  });

  test("rejects authenticated non-admin users", async () => {
    vi.stubEnv("USESEND_EXAMPLE_ADMIN_TOKEN_IDENTIFIER", "admin-token");
    const t = initConvexTest().withIdentity({ tokenIdentifier: "user-token" });

    await expect(t.action(api.example.listDomains)).rejects.toThrow(
      "Administrator access required",
    );
  });
});
