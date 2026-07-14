import { describe, expect, test } from "vitest";
import { UseSend } from "./index.js";

describe("UseSend client", () => {
  test("should export UseSend class", () => {
    expect(UseSend).toBeDefined();
    expect(typeof UseSend).toBe("function");
  });

  test("should have correct default config", () => {
    // Test that the class can be instantiated with mock component
    const mockComponent = {} as any;
    const usesend = new UseSend(mockComponent, {});

    // Check default values
    expect(usesend.config.initialBackoffMs).toBe(30000);
    expect(usesend.config.retryAttempts).toBe(5);
    expect(usesend.config.baseUrl).toBe("https://app.usesend.com");
  });

  test("should accept custom options", () => {
    const mockComponent = {} as any;
    const usesend = new UseSend(mockComponent, {
      apiKey: "test-api-key",
      baseUrl: "https://custom.usesend.com",
      initialBackoffMs: 60000,
      retryAttempts: 10,
      webhookSecret: "test-webhook-secret",
    });

    expect(usesend.config.apiKey).toBe("test-api-key");
    expect(usesend.config.baseUrl).toBe("https://custom.usesend.com");
    expect(usesend.config.initialBackoffMs).toBe(60000);
    expect(usesend.config.retryAttempts).toBe(10);
    expect(usesend.config.webhookSecret).toBe("test-webhook-secret");
  });

  test("should throw error when webhook secret is not set", async () => {
    const mockComponent = {} as any;
    const usesend = new UseSend(mockComponent, {
      webhookSecret: "", // Empty secret
    });

    const mockRequest = new Request("http://localhost/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "email.delivered" }),
    });

    await expect(
      usesend.handleUseSendEventWebhook({} as any, mockRequest),
    ).rejects.toThrow("Webhook secret is not set");
  });
});
