/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component lib", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sendEmail creates an email record", async () => {
    const t = initConvexTest();

    const emailId = await t.mutation(api.lib.sendEmail, {
      from: "test@example.com",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      html: "<p>Test content</p>",
      options: {
        apiKey: "test-api-key",
        baseUrl: "https://app.usesend.com",
        initialBackoffMs: 30000,
        retryAttempts: 5,
      },
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
      options: {
        apiKey: "test-api-key",
        baseUrl: "https://app.usesend.com",
        initialBackoffMs: 30000,
        retryAttempts: 5,
      },
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
      options: {
        apiKey: "test-api-key",
        baseUrl: "https://app.usesend.com",
        initialBackoffMs: 30000,
        retryAttempts: 5,
      },
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
});
