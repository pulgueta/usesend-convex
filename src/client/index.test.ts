import { describe, expect, test } from "vitest";
import { type EmailEvent, type EmailId, UseSend } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

function createClient() {
  return new UseSend(components.usesend, {
    apiKey: "test-api-key",
    webhookSecret: "test-webhook-secret",
  });
}

async function hmac(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function deliveredEvent(usesendId: string): EmailEvent {
  return {
    id: "call_1",
    type: "email.delivered",
    version: "2026-01-18",
    createdAt: "2026-07-14T20:00:00.000Z",
    teamId: 1,
    attempt: 1,
    data: {
      id: usesendId,
      status: "DELIVERED",
      from: "sender@example.com",
      to: ["recipient@example.com"],
      occurredAt: "2026-07-14T20:00:00.000Z",
    },
  };
}

async function signedWebhookRequest(secret: string, event: EmailEvent) {
  const raw = JSON.stringify(event);
  const timestamp = String(Date.now());
  const signature = await hmac(secret, `${timestamp}.${raw}`);
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "X-UseSend-Signature": `v1=${signature}`,
      "X-UseSend-Timestamp": timestamp,
    },
    body: raw,
  });
}

describe("UseSend client", () => {
  test("uses the documented defaults", () => {
    const usesend = new UseSend(components.usesend, { apiKey: "test-api-key" });

    expect(usesend.config).toMatchObject({
      initialBackoffMs: 30000,
      retryAttempts: 5,
      requestTimeoutMs: 30000,
      baseUrl: "https://app.usesend.com",
    });
  });

  test("accepts custom options", () => {
    const usesend = new UseSend(components.usesend, {
      apiKey: "test-api-key",
      baseUrl: "https://custom.usesend.com",
      initialBackoffMs: 60000,
      retryAttempts: 10,
      requestTimeoutMs: 10000,
      webhookSecret: "test-webhook-secret",
    });

    expect(usesend.config).toMatchObject({
      apiKey: "test-api-key",
      baseUrl: "https://custom.usesend.com",
      initialBackoffMs: 60000,
      retryAttempts: 10,
      requestTimeoutMs: 10000,
      webhookSecret: "test-webhook-secret",
    });
  });

  test("sends durable emails through the component without forwarding the API key", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    const emailId = await t.run((ctx) =>
      usesend.sendEmail(ctx, {
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Hello",
      }),
    );

    // Regression for #4: the component's options validator rejects unknown
    // fields (including apiKey), so a successful enqueue proves the raw key
    // never crossed the component boundary into durable storage.
    const status = await t.run((ctx) => usesend.status(ctx, emailId));
    expect(status?.status).toBe("waiting");
    const email = await t.run((ctx) => usesend.get(ctx, emailId));
    expect(email).toMatchObject({
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Hello",
      text: "Hello",
    });
  });

  test("cancels a pending durable email", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    const emailId = await t.run((ctx) =>
      usesend.sendEmail(ctx, {
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Hello",
      }),
    );
    await t.run((ctx) => usesend.cancelEmail(ctx, emailId));

    const status = await t.run((ctx) => usesend.status(ctx, emailId));
    expect(status?.status).toBe("cancelled");
  });

  test("tracks a successful manual send with its provider ID", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    const emailId = await t.run((ctx) =>
      usesend.sendEmailManually(
        ctx,
        {
          from: "sender@example.com",
          to: "recipient@example.com",
          cc: "cc@example.com",
          bcc: ["bcc@example.com"],
          subject: "Hello",
        },
        async () => "usesend_1",
      ),
    );

    const email = await t.run((ctx) => usesend.get(ctx, emailId));
    expect(email).toMatchObject({
      status: "sent",
      usesendId: "usesend_1",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
  });

  test("marks a manual send failed when the send callback throws", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    // Catch inside t.run so the transaction commits the failure bookkeeping.
    const { emailId, message } = await t.run(async (ctx) => {
      let capturedId: EmailId | undefined;
      try {
        await usesend.sendEmailManually(
          ctx,
          {
            from: "sender@example.com",
            to: "recipient@example.com",
            subject: "Hello",
          },
          async (id) => {
            capturedId = id;
            throw new Error("provider down");
          },
        );
        return { emailId: capturedId, message: null };
      } catch (error) {
        return { emailId: capturedId, message: (error as Error).message };
      }
    });

    expect(message).toBe("provider down");
    const status = await t.run((ctx) => usesend.status(ctx, emailId!));
    expect(status).toMatchObject({
      status: "failed",
      failed: true,
      errorMessage: "provider down",
    });
  });

  test("accepts a correctly signed webhook and applies the event", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    const emailId = await t.run((ctx) =>
      usesend.sendEmailManually(
        ctx,
        {
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Hello",
        },
        async () => "usesend_1",
      ),
    );
    const request = await signedWebhookRequest(
      "test-webhook-secret",
      deliveredEvent("usesend_1"),
    );

    // t.run results must be Convex values, so unwrap the Response inside it.
    const responseStatus = await t.run(async (ctx) => {
      const response = await usesend.handleUseSendEventWebhook(ctx, request);
      return response.status;
    });

    expect(responseStatus).toBe(200);
    const status = await t.run((ctx) => usesend.status(ctx, emailId));
    expect(status?.status).toBe("delivered");
  });

  test("rejects a webhook with an invalid signature", async () => {
    const t = initConvexTest();
    const usesend = createClient();

    const emailId = await t.run((ctx) =>
      usesend.sendEmailManually(
        ctx,
        {
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Hello",
        },
        async () => "usesend_1",
      ),
    );
    const request = await signedWebhookRequest(
      "wrong-secret",
      deliveredEvent("usesend_1"),
    );

    const responseStatus = await t.run(async (ctx) => {
      const response = await usesend.handleUseSendEventWebhook(ctx, request);
      return response.status;
    });

    expect(responseStatus).toBe(401);
    const status = await t.run((ctx) => usesend.status(ctx, emailId));
    expect(status?.status).toBe("sent");
  });

  test("rejects webhook handling when the secret is missing", async () => {
    const t = initConvexTest();
    const usesend = new UseSend(components.usesend, { webhookSecret: "" });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "{}",
    });

    await expect(
      t.run((ctx) => usesend.handleUseSendEventWebhook(ctx, request)),
    ).rejects.toThrow("Webhook secret is not set");
  });
});
