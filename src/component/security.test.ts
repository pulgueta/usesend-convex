/// <reference types="vite/client" />

// Regression suite for https://github.com/pulgueta/usesend-convex/issues/4:
// raw useSend API keys must never be persisted in component documents. The
// durable sender resolves the credential at execution time from the
// component's USESEND_API_KEY environment variable instead.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { RuntimeConfig } from "./shared.js";
import schema from "./schema.js";
import { initConvexTest } from "./setup.test.js";

const TEST_API_KEY = "us_test_plaintext_secret_key";

const options: RuntimeConfig = {
  baseUrl: "https://app.usesend.com",
  initialBackoffMs: 30000,
  retryAttempts: 5,
  requestTimeoutMs: 30000,
};

async function collectAllDocuments(t: ReturnType<typeof initConvexTest>) {
  return await t.run(async (ctx) => {
    const tables = Object.keys(schema.tables) as Array<
      keyof typeof schema.tables
    >;
    const docs: Record<string, unknown[]> = {};
    for (const table of tables) {
      docs[table] = await ctx.db.query(table).collect();
    }
    return docs;
  });
}

describe("api key persistence (issue #4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("USESEND_API_KEY", TEST_API_KEY);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("no stored document contains the API key after a durable send", async () => {
    const t = initConvexTest();

    const emailId = await t.mutation(api.lib.sendEmail, {
      options,
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Hello",
      html: "<p>Hello</p>",
    });

    // Drive the email through the batch API call the way the workpool would.
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ emailId: "usesend_1", status: "queued" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.lib.callUseSendAPIWithBatch, {
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [emailId],
    });

    // The credential was used for the provider call...
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)["Authorization"],
    ).toBe(`Bearer ${TEST_API_KEY}`);

    // ...but no durable document in any component table contains it.
    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
    expect(docs.emails).toHaveLength(1);
  });

  test("no stored document contains the API key after a manual send", async () => {
    const t = initConvexTest();

    await t.mutation(api.lib.createManualEmail, {
      options,
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Hello",
    });

    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
  });

  test("component mutations reject options that include an apiKey", async () => {
    const t = initConvexTest();
    const leakyOptions = {
      ...options,
      apiKey: TEST_API_KEY,
    } as unknown as RuntimeConfig;

    await expect(
      t.mutation(api.lib.sendEmail, {
        options: leakyOptions,
        from: "sender@example.com",
        to: ["recipient@example.com"],
        subject: "Hello",
        html: "<p>Hello</p>",
      }),
    ).rejects.toThrow(/apiKey/);

    await expect(
      t.mutation(api.lib.createManualEmail, {
        options: leakyOptions,
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Hello",
      }),
    ).rejects.toThrow(/apiKey/);

    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
  });

  test("the batch sender fails clearly when the env var is missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("USESEND_API_KEY", "");
    const t = initConvexTest();

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      t.action(internal.lib.callUseSendAPIWithBatch, {
        baseUrl: options.baseUrl,
        requestTimeoutMs: options.requestTimeoutMs,
        emails: [],
      }),
    ).rejects.toThrow("USESEND_API_KEY is not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("scrubApiKeys strips legacy plaintext keys from stored rows", async () => {
    const t = initConvexTest();

    // A row written by <= 0.1.1, where options carried the raw key.
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("emails", {
        options: { ...options, apiKey: TEST_API_KEY },
        from: "sender@example.com",
        to: ["recipient@example.com"],
        subject: "Legacy",
        replyTo: [],
        segment: Infinity,
        status: "sent",
        bounced: false,
        complained: false,
        failed: false,
        deliveryDelayed: false,
        opened: false,
        clicked: false,
        retentionAnchor: 0,
        finalizedAt: 0,
      }),
    );
    const modernId = await t.mutation(api.lib.createManualEmail, {
      options,
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Modern",
    });

    await t.mutation(api.lib.scrubApiKeys, {});

    const [legacy, modern] = await t.run((ctx) =>
      Promise.all([ctx.db.get(legacyId), ctx.db.get(modernId)]),
    );
    expect(legacy?.options).toEqual(options);
    expect(modern?.options).toEqual(options);
    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
  });

  test("scrubApiKeys paginates past batches of rows sharing a creation time", async () => {
    const t = initConvexTest();

    // With fake timers frozen, bulk inserts share a creation timestamp —
    // the scenario where a plain _creationTime cursor would skip rows.
    const ROWS = 150;
    await t.run(async (ctx) => {
      for (let i = 0; i < ROWS; i++) {
        await ctx.db.insert("emails", {
          options: { ...options, apiKey: TEST_API_KEY },
          from: "sender@example.com",
          to: ["recipient@example.com"],
          subject: `Legacy ${i}`,
          replyTo: [],
          segment: Infinity,
          status: "sent",
          bounced: false,
          complained: false,
          failed: false,
          deliveryDelayed: false,
          opened: false,
          clicked: false,
          retentionAnchor: 0,
          finalizedAt: 0,
        });
      }
    });

    await t.mutation(api.lib.scrubApiKeys, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.run(async (ctx) => {
      const emails = await ctx.db.query("emails").collect();
      return emails.filter((email) => email.options.apiKey !== undefined);
    });
    expect(remaining).toHaveLength(0);
    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
  });

  test("scrubApiKeys keeps the stored key on active rows so mismatches still fail", async () => {
    const t = initConvexTest();
    const insertLegacy = (subject: string, status: "queued" | "sent") =>
      t.run((ctx) =>
        ctx.db.insert("emails", {
          options: { ...options, apiKey: "some-other-key" },
          from: "sender@example.com",
          to: ["recipient@example.com"],
          subject,
          replyTo: [],
          segment: Infinity,
          status,
          bounced: false,
          complained: false,
          failed: false,
          deliveryDelayed: false,
          opened: false,
          clicked: false,
          retentionAnchor: 0,
          finalizedAt: 0,
        }),
      );
    const activeId = await insertLegacy("Active", "queued");
    const finalizedId = await insertLegacy("Finalized", "sent");

    await t.mutation(api.lib.scrubApiKeys, {});

    // Finalized rows are scrubbed; active rows keep the evidence the batch
    // sender needs to detect a credential mismatch.
    const [active, finalized] = await t.run((ctx) =>
      Promise.all([ctx.db.get(activeId), ctx.db.get(finalizedId)]),
    );
    expect(finalized?.options.apiKey).toBeUndefined();
    expect(active?.options.apiKey).toBe("some-other-key");

    // The P1 upgrade race: even after a scrub run, the mismatched active row
    // must still fail explicitly instead of being sent through the wrong
    // useSend account with the env credential.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.lib.callUseSendAPIWithBatch, {
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [activeId],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await t.query(api.lib.getStatus, { emailId: activeId }),
    ).toMatchObject({
      status: "failed",
      failed: true,
      errorMessage: expect.stringContaining("does not match"),
    });

    // Once failed (finalized), a re-run finishes the scrub.
    await t.mutation(api.lib.scrubApiKeys, {});
    const drained = await t.run((ctx) => ctx.db.get(activeId));
    expect(drained?.options.apiKey).toBeUndefined();
  });

  test("legacy rows drain with the env key only when their stored key matches", async () => {
    const t = initConvexTest();
    const insertLegacy = (subject: string, apiKey: string) =>
      t.run((ctx) =>
        ctx.db.insert("emails", {
          options: { ...options, apiKey },
          from: "sender@example.com",
          to: ["recipient@example.com"],
          subject,
          replyTo: [],
          segment: Infinity,
          status: "queued",
          bounced: false,
          complained: false,
          failed: false,
          deliveryDelayed: false,
          opened: false,
          clicked: false,
          retentionAnchor: 0,
          finalizedAt: 0,
        }),
      );
    // Stored key matches the bound credential: drains normally.
    const matchingId = await insertLegacy("Matching", TEST_API_KEY);
    // Stored key differs (a <= 0.1.1 multi-instance setup): must not be
    // silently delivered through the wrong useSend account.
    const mismatchedId = await insertLegacy("Mismatched", "some-other-key");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ emailId: "usesend_1", status: "queued" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.lib.callUseSendAPIWithBatch, {
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [matchingId, mismatchedId],
    });

    expect(await t.query(api.lib.getStatus, { emailId: matchingId })).toMatchObject(
      { status: "sent" },
    );
    expect(
      await t.query(api.lib.getStatus, { emailId: mismatchedId }),
    ).toMatchObject({
      status: "failed",
      failed: true,
      errorMessage: expect.stringContaining("does not match"),
    });
    // Only the matching email went to the provider.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toHaveLength(1);
  });

  test("the batch sender tolerates and ignores a legacy apiKey arg", async () => {
    const t = initConvexTest();
    const emailId = await t.mutation(api.lib.createManualEmail, {
      options,
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Hello",
    });
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ emailId: "usesend_1", status: "queued" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Workpool jobs enqueued by <= 0.1.1 still carry apiKey in their
    // persisted args; they must pass validation and use the env credential.
    await t.action(internal.lib.callUseSendAPIWithBatch, {
      apiKey: "stale-legacy-key",
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [emailId],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TEST_API_KEY}`,
    );
  });
});
