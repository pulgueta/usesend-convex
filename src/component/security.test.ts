/// <reference types="vite/client" />

// Regression suite for https://github.com/pulgueta/usesend-convex/issues/4.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { RuntimeConfig } from "./shared.js";
import schema from "./schema.js";
import { initConvexTest } from "./test.setup.js";

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

async function collectEmailWorkpoolDocuments(
  t: ReturnType<typeof initConvexTest>,
) {
  const scoped = t as typeof t & {
    runInComponent: <Output>(
      path: string,
      handler: (ctx: {
        db: {
          query: (table: string) => { collect: () => Promise<unknown[]> };
        };
      }) => Promise<Output>,
    ) => Promise<Output>;
  };
  return scoped.runInComponent("emailWorkpool", async (ctx) => ({
    work: await ctx.db.query("work").collect(),
    payload: await ctx.db.query("payload").collect(),
  }));
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

    await t.mutation(internal.lib.makeBatch, {
      reloop: false,
      segment: Infinity,
    });
    const durableJob = await collectEmailWorkpoolDocuments(t);
    expect(JSON.stringify(durableJob)).not.toContain(TEST_API_KEY);
    expect(durableJob.work).toHaveLength(1);

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

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TEST_API_KEY}`,
    );

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
    await t.finishAllScheduledFunctions(vi.runAllTimers);

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
    await t.mutation(api.lib.scrubApiKeys, {});
    expect(
      await t.run((ctx) => ctx.db.query("migrationLeases").collect()),
    ).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const remaining = await t.run(async (ctx) => {
      const emails = await ctx.db.query("emails").collect();
      return emails.filter((email) => email.options.apiKey !== undefined);
    });
    expect(remaining).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("migrationLeases").collect()),
    ).toHaveLength(0);
    const docs = await collectAllDocuments(t);
    expect(JSON.stringify(docs)).not.toContain(TEST_API_KEY);
  });

  test("scrubApiKeys fails active legacy rows while removing their keys", async () => {
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
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [active, finalized] = await t.run((ctx) =>
      Promise.all([ctx.db.get(activeId), ctx.db.get(finalizedId)]),
    );
    expect(finalized?.options.apiKey).toBeUndefined();
    expect(active).toMatchObject({
      options,
      status: "failed",
      failed: true,
      errorMessage: expect.stringContaining("previous component version"),
    });
    expect(JSON.stringify(await collectAllDocuments(t))).not.toContain(
      "some-other-key",
    );
  });

  test("the batch sender rejects and scrubs legacy queued rows", async () => {
    const t = initConvexTest();
    const emailId = await t.run((ctx) =>
      ctx.db.insert("emails", {
        options: { ...options, apiKey: TEST_API_KEY },
        from: "sender@example.com",
        to: ["recipient@example.com"],
        subject: "Legacy",
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const queryResult = await t.query(internal.lib.getEmailsByIds, {
      emailIds: [emailId],
    });
    expect(queryResult[0]).toMatchObject({ legacyApiKey: true, options });
    expect(JSON.stringify(queryResult)).not.toContain(TEST_API_KEY);

    await t.action(internal.lib.callUseSendAPIWithBatch, {
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [emailId],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.get(emailId))).toMatchObject({
      options,
      status: "failed",
      failed: true,
    });
  });
});
