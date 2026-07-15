/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import type { EmailEvent, RuntimeConfig } from "./shared.js";
import { initConvexTest } from "./setup.test.js";

const options: RuntimeConfig = {
  apiKey: "test-api-key",
  baseUrl: "https://app.usesend.com",
  initialBackoffMs: 30000,
  retryAttempts: 5,
  requestTimeoutMs: 30000,
};

function event(
  type: "email.delivered" | "email.cancelled",
  eventId: string,
  usesendId: string,
): EmailEvent {
  const common = {
    id: eventId,
    version: "2026-01-18",
    createdAt: "2026-07-14T20:00:00.000Z",
    teamId: 1,
    attempt: 1,
  };
  const data = {
    id: usesendId,
    status: type === "email.delivered" ? "DELIVERED" : "CANCELLED",
    from: "sender@example.com",
    to: ["recipient@example.com"],
    occurredAt: "2026-07-14T20:00:00.000Z",
  };
  return type === "email.delivered"
    ? { ...common, type: "email.delivered", data }
    : { ...common, type: "email.cancelled", data };
}

async function createManualEmail(
  t: ReturnType<typeof initConvexTest>,
  usesendId?: string,
) {
  const emailId = await t.mutation(api.lib.createManualEmail, {
    options,
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "Hello",
  });
  if (usesendId) {
    await t.mutation(api.lib.updateManualEmail, {
      emailId,
      status: "sent",
      usesendId,
    });
  }
  return emailId;
}

describe("component lib", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("sendEmail creates an email record", async () => {
    const t = initConvexTest();

    const emailId = await t.mutation(api.lib.sendEmail, {
      from: "test@example.com",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      html: "<p>Test content</p>",
      options,
    });

    expect(emailId).toBeDefined();

    // Check status
    const status = await t.query(api.lib.getStatus, { emailId });
    expect(status).toBeDefined();
    expect(status?.status).toBe("waiting");
  });

  test("cancelEmail cancels a waiting email", async () => {
    const t = initConvexTest();

    const emailId = await t.mutation(api.lib.sendEmail, {
      from: "test@example.com",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      html: "<p>Test content</p>",
      options,
    });

    await t.mutation(api.lib.cancelEmail, { emailId });

    const status = await t.query(api.lib.getStatus, { emailId });
    expect(status?.status).toBe("cancelled");
  });

  test("get returns full email details", async () => {
    const t = initConvexTest();

    const emailId = await t.mutation(api.lib.sendEmail, {
      from: "test@example.com",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      html: "<p>Test content</p>",
      text: "Test content",
      replyTo: ["reply@example.com"],
      scheduledAt: "2026-08-01T09:00:00Z",
      inReplyToId: "prev-email-id",
      options,
    });

    const email = await t.query(api.lib.get, { emailId });
    expect(email).toBeDefined();
    expect(email?.from).toBe("test@example.com");
    expect(email?.to).toEqual(["recipient@example.com"]);
    expect(email?.subject).toBe("Test Subject");
    expect(email?.html).toBe("<p>Test content</p>");
    expect(email?.text).toBe("Test content");
    expect(email?.replyTo).toEqual(["reply@example.com"]);
    expect(email?.scheduledAt).toBe("2026-08-01T09:00:00Z");
    expect(email?.inReplyToId).toBe("prev-email-id");
    expect(email?.status).toBe("waiting");
  });

  test("cancelEmail rejects an email once batching has started", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t);
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));

    await expect(t.mutation(api.lib.cancelEmail, { emailId })).rejects.toThrow(
      "Email has already been sent",
    );
    expect((await t.query(api.lib.getStatus, { emailId }))?.status).toBe(
      "queued",
    );
  });

  test("stores runtime options with each email", async () => {
    const t = initConvexTest();
    const firstId = await createManualEmail(t);
    const secondOptions = { ...options, apiKey: "other-api-key" };
    const secondId = await t.mutation(api.lib.createManualEmail, {
      options: secondOptions,
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Hello",
    });

    const [first, second] = await t.run((ctx) =>
      Promise.all([ctx.db.get(firstId), ctx.db.get(secondId)]),
    );
    expect(first?.options).toEqual(options);
    expect(second?.options).toEqual(secondOptions);
  });

  test("stores all recipients for manually sent emails", async () => {
    const t = initConvexTest();
    const emailId = await t.mutation(api.lib.createManualEmail, {
      options,
      from: "sender@example.com",
      to: "recipient@example.com",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      subject: "Hello",
    });

    expect(await t.query(api.lib.get, { emailId })).toMatchObject({
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
  });

  test("replaces a stale batch-run sentinel", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.sendEmail, {
      options,
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "First",
      text: "First",
    });
    const firstRun = await t.run((ctx) =>
      ctx.db.query("nextBatchRun").unique(),
    );
    expect(firstRun).not.toBeNull();
    await t.run((ctx) => ctx.scheduler.cancel(firstRun!.runId));

    await t.mutation(api.lib.sendEmail, {
      options,
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Second",
      text: "Second",
    });
    const secondRun = await t.run((ctx) =>
      ctx.db.query("nextBatchRun").unique(),
    );
    expect(secondRun?.runId).not.toBe(firstRun?.runId);
  });

  test("validates and persists batch response IDs before completion", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t);
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ emailId: "usesend_1", status: "queued" }],
            requestId: "request_1",
          }),
        ),
      ),
    );

    await t.action(internal.lib.callUseSendAPIWithBatch, {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: [emailId],
    });

    const email = await t.query(api.lib.get, { emailId });
    expect(email).toMatchObject({ status: "sent", usesendId: "usesend_1" });
  });

  test("rejects incomplete batch responses without marking emails sent", async () => {
    const t = initConvexTest();
    const firstId = await createManualEmail(t);
    const secondId = await createManualEmail(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(firstId, { status: "queued" });
      await ctx.db.patch(secondId, { status: "queued" });
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ emailId: "usesend_1" }] })),
        ),
    );

    await expect(
      t.action(internal.lib.callUseSendAPIWithBatch, {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        requestTimeoutMs: options.requestTimeoutMs,
        emails: [firstId, secondId],
      }),
    ).rejects.toThrow("expected 2 email IDs, received 1");
    expect(
      (await t.query(api.lib.getStatus, { emailId: firstId }))?.status,
    ).toBe("queued");
  });

  test("aborts a batch request after the configured timeout", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t);
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));
    let markFetchStarted: () => void = () => undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        markFetchStarted();
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }),
    );

    const request = t.action(internal.lib.callUseSendAPIWithBatch, {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      requestTimeoutMs: 50,
      emails: [emailId],
    });
    await fetchStarted;
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("marks failed batches consistently", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t);
    await t.run((ctx) => ctx.db.patch(emailId, { status: "queued" }));

    await t.mutation(internal.lib.markEmailsFailed, {
      emailIds: [emailId],
      errorMessage: "provider rejected the batch",
    });

    expect(await t.query(api.lib.getStatus, { emailId })).toMatchObject({
      status: "failed",
      failed: true,
      errorMessage: "provider rejected the batch",
    });
  });

  test("deduplicates webhook events and patches status safely", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t, "usesend_1");
    const delivered = event("email.delivered", "call_1", "usesend_1");

    await t.mutation(api.lib.handleEmailEvent, { event: delivered });
    await t.mutation(api.lib.handleEmailEvent, { event: delivered });

    expect((await t.query(api.lib.getStatus, { emailId }))?.status).toBe(
      "delivered",
    );
    const deliveryEvents = await t.run((ctx) =>
      ctx.db.query("deliveryEvents").collect(),
    );
    expect(deliveryEvents).toHaveLength(1);
  });

  test("preserves cancelled provider events without marking failure", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t, "usesend_1");

    await t.mutation(api.lib.handleEmailEvent, {
      event: event("email.cancelled", "call_1", "usesend_1"),
    });

    expect(await t.query(api.lib.getStatus, { emailId })).toMatchObject({
      status: "cancelled",
      failed: false,
    });
  });

  test("retries a webhook that arrives before its provider ID is persisted", async () => {
    const t = initConvexTest();
    const emailId = await createManualEmail(t);
    await t.mutation(api.lib.handleEmailEvent, {
      event: event("email.delivered", "call_1", "usesend_1"),
    });
    await t.mutation(api.lib.updateManualEmail, {
      emailId,
      status: "sent",
      usesendId: "usesend_1",
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await t.query(api.lib.getStatus, { emailId }))?.status).toBe(
      "delivered",
    );
    expect(
      await t.run((ctx) => ctx.db.query("pendingEvents").collect()),
    ).toHaveLength(0);
  });

  test("does not delete an email scheduled beyond the retention window", async () => {
    const t = initConvexTest();
    const emailId = await t.mutation(api.lib.sendEmail, {
      options,
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Future",
      text: "Future",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    });

    await t.mutation(api.lib.cleanupAbandonedEmails, { olderThan: 0 });

    expect(await t.query(api.lib.get, { emailId })).not.toBeNull();
  });
});
