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
});
