import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { initConvexTest } from "./test.setup";

describe("example", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  test("reads component emails from an action context", async () => {
    vi.stubEnv("USESEND_EXAMPLE_ADMIN_TOKEN_IDENTIFIER", "admin-token");
    const t = initConvexTest().withIdentity({
      tokenIdentifier: "admin-token",
    });

    const emailId = await t.mutation(api.example.sendTestEmail);
    await expect(
      t.action(internal.example.confirmEmailFromAction, { emailId }),
    ).resolves.toEqual({ found: true, status: "waiting" });
  });

  test("sends through child components registered by the package test helper", async () => {
    vi.stubEnv("USESEND_EXAMPLE_ADMIN_TOKEN_IDENTIFIER", "admin-token");
    vi.stubEnv("USESEND_API_KEY", "us_test_api_key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ emailId: "usesend_1" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const t = initConvexTest().withIdentity({
      tokenIdentifier: "admin-token",
    });

    const emailId = await t.mutation(api.example.sendTestEmail);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
      t.query(api.example.getEmailStatus, { emailId }),
    ).resolves.toMatchObject({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("renders and enqueues the bundled React Email integration", async () => {
    const t = initConvexTest();
    const emailId = await t.action(internal.reactEmail.sendWelcomeEmail, {
      to: "ada@example.com",
      name: "Ada Lovelace",
      verificationUrl: "https://example.com/verify?token=abc123",
    });

    const email = await t.run((ctx) =>
      ctx.runQuery(components.usesend.lib.get, { emailId }),
    );
    expect(email).toMatchObject({
      to: ["ada@example.com"],
      subject: "Welcome, Ada Lovelace!",
      status: "waiting",
    });
    expect(email?.html).toContain("Welcome, Ada Lovelace!");
    expect(email?.html).toContain(
      'href="https://example.com/verify?token=abc123"',
    );
    expect(email?.text).toContain("WELCOME, ADA LOVELACE!");
    expect(email?.text).not.toContain("<html");
  });
});
