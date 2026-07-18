import { describe, expect, test, vi } from "vitest";
import { type EmailEvent, type UseSendComponent, UseSend } from "./index.js";

const functions = {
  sendEmail: Symbol("sendEmail"),
  cancelEmail: Symbol("cancelEmail"),
  getStatus: Symbol("getStatus"),
  get: Symbol("get"),
  createManualEmail: Symbol("createManualEmail"),
  updateManualEmail: Symbol("updateManualEmail"),
  handleEmailEvent: Symbol("handleEmailEvent"),
};

const component = { lib: functions } as unknown as UseSendComponent;

function createClient() {
  return new UseSend(component, {
    apiKey: "test-api-key",
    webhookSecret: "test-webhook-secret",
  });
}

function mutationCtx(runMutation: ReturnType<typeof vi.fn>) {
  return { runMutation } as unknown as Parameters<UseSend["sendEmail"]>[0];
}

function queryCtx(runQuery: ReturnType<typeof vi.fn>) {
  return { runQuery } as unknown as Parameters<UseSend["status"]>[0];
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

describe("UseSend client", () => {
  test("uses the documented defaults", () => {
    const usesend = new UseSend(component, { apiKey: "test-api-key" });

    expect(usesend.config).toMatchObject({
      initialBackoffMs: 30000,
      retryAttempts: 5,
      requestTimeoutMs: 30000,
      baseUrl: "https://app.usesend.com",
    });
  });

  test("accepts custom options", () => {
    const usesend = new UseSend(component, {
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

  test("delegates durable email methods to the component", async () => {
    const usesend = createClient();
    const runMutation = vi.fn().mockResolvedValue("email_1");
    const runQuery = vi.fn().mockResolvedValue({ status: "waiting" });

    const emailId = await usesend.sendEmail(mutationCtx(runMutation), {
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Hello",
    });
    expect(emailId).toBe("email_1");
    expect(runMutation).toHaveBeenCalledWith(functions.sendEmail, {
      options: {
        baseUrl: "https://app.usesend.com",
        initialBackoffMs: 30000,
        retryAttempts: 5,
        requestTimeoutMs: 30000,
        onEmailEvent: undefined,
      },
      from: "sender@example.com",
      to: ["recipient@example.com"],
      subject: "Hello",
      text: "Hello",
      cc: undefined,
      bcc: undefined,
    });

    await usesend.cancelEmail(mutationCtx(runMutation), emailId);
    expect(runMutation).toHaveBeenLastCalledWith(functions.cancelEmail, {
      emailId,
    });

    await usesend.status(queryCtx(runQuery), emailId);
    expect(runQuery).toHaveBeenLastCalledWith(functions.getStatus, { emailId });

    await usesend.get(queryCtx(runQuery), emailId);
    expect(runQuery).toHaveBeenLastCalledWith(functions.get, { emailId });

    // Regression for #4: the raw API key must never cross the component
    // boundary, where it would be persisted in durable documents.
    expect(JSON.stringify(runMutation.mock.calls)).not.toContain(
      "test-api-key",
    );
  });

  test("tracks a successful manual send with its provider ID", async () => {
    const usesend = createClient();
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("email_1")
      .mockResolvedValueOnce(null);
    const sendCallback = vi.fn().mockResolvedValue("usesend_1");

    await expect(
      usesend.sendEmailManually(
        mutationCtx(runMutation),
        {
          from: "sender@example.com",
          to: "recipient@example.com",
          cc: "cc@example.com",
          bcc: ["bcc@example.com"],
          subject: "Hello",
        },
        sendCallback,
      ),
    ).resolves.toBe("email_1");

    expect(sendCallback).toHaveBeenCalledWith("email_1");
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      functions.createManualEmail,
      {
        options: {
          baseUrl: "https://app.usesend.com",
          initialBackoffMs: 30000,
          retryAttempts: 5,
          requestTimeoutMs: 30000,
          onEmailEvent: undefined,
        },
        from: "sender@example.com",
        to: "recipient@example.com",
        cc: ["cc@example.com"],
        bcc: ["bcc@example.com"],
        subject: "Hello",
        replyTo: undefined,
        headers: undefined,
      },
    );
    expect(runMutation).toHaveBeenLastCalledWith(functions.updateManualEmail, {
      emailId: "email_1",
      status: "sent",
      usesendId: "usesend_1",
    });
  });

  test("does not relabel a sent email when bookkeeping fails", async () => {
    const usesend = createClient();
    const bookkeepingError = new Error("bookkeeping failed");
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce("email_1")
      .mockRejectedValueOnce(bookkeepingError);

    await expect(
      usesend.sendEmailManually(
        mutationCtx(runMutation),
        {
          from: "sender@example.com",
          to: "recipient@example.com",
          subject: "Hello",
        },
        vi.fn().mockResolvedValue("usesend_1"),
      ),
    ).rejects.toBe(bookkeepingError);

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenLastCalledWith(functions.updateManualEmail, {
      emailId: "email_1",
      status: "sent",
      usesendId: "usesend_1",
    });
  });

  test("accepts a correctly signed webhook with a millisecond timestamp", async () => {
    const usesend = createClient();
    const event: EmailEvent = {
      id: "call_1",
      type: "email.delivered",
      version: "2026-01-18",
      createdAt: "2026-07-14T20:00:00.000Z",
      teamId: 1,
      data: {
        id: "usesend_1",
        status: "DELIVERED",
        from: "sender@example.com",
        to: ["recipient@example.com"],
        occurredAt: "2026-07-14T20:00:00.000Z",
      },
      attempt: 1,
    };
    const raw = JSON.stringify(event);
    const timestamp = String(Date.now());
    const signature = await hmac("test-webhook-secret", `${timestamp}.${raw}`);
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "X-UseSend-Signature": `v1=${signature}`,
        "X-UseSend-Timestamp": timestamp,
      },
      body: raw,
    });
    const runMutation = vi.fn().mockResolvedValue(null);

    const response = await usesend.handleUseSendEventWebhook(
      { runMutation } as unknown as Parameters<
        UseSend["handleUseSendEventWebhook"]
      >[0],
      request,
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(functions.handleEmailEvent, {
      event,
    });
  });

  test("rejects webhook handling when the secret is missing", async () => {
    const usesend = new UseSend(component, { webhookSecret: "" });
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      body: "{}",
    });

    await expect(
      usesend.handleUseSendEventWebhook(
        { runMutation: vi.fn() } as unknown as Parameters<
          UseSend["handleUseSendEventWebhook"]
        >[0],
        request,
      ),
    ).rejects.toThrow("Webhook secret is not set");
  });
});
