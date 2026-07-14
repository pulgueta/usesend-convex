import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UseSendApi, UseSendApiError } from "./api.js";

function mockFetch(status = 200, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  return { url, init };
}

describe("UseSendApi", () => {
  beforeEach(() => {
    mockFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const api = new UseSendApi({
    apiKey: "test-api-key",
    baseUrl: "https://usesend.example.com",
  });

  test("throws when API key is empty", () => {
    expect(() => new UseSendApi({ apiKey: "" })).toThrow("API key is not set");
  });

  test("defaults to the hosted useSend base URL", async () => {
    const fetchMock = mockFetch();
    await new UseSendApi({ apiKey: "key" }).domains.list();
    const { url } = requestOf(fetchMock);
    expect(url.toString()).toBe("https://app.usesend.com/api/v1/domains");
  });

  test("sends authorization and content-type headers", async () => {
    const fetchMock = mockFetch(200, { emailId: "email_123" });
    await api.emails.send({
      to: "a@b.com",
      from: "c@d.com",
      subject: "Hi",
      text: "Hello",
    });
    const { url, init } = requestOf(fetchMock);
    expect(url.toString()).toBe("https://usesend.example.com/api/v1/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: "a@b.com",
      subject: "Hi",
    });
  });

  test("passes idempotency key header", async () => {
    const fetchMock = mockFetch(200, { data: [] });
    await api.emails.batch([{ to: "a@b.com", from: "c@d.com" }], {
      idempotencyKey: "order-42",
    });
    const { init } = requestOf(fetchMock);
    expect(init.headers).toMatchObject({ "Idempotency-Key": "order-42" });
  });

  test("serializes query params and skips undefined ones", async () => {
    const fetchMock = mockFetch(200, { data: [], count: 0 });
    await api.emails.list({
      page: 2,
      limit: 10,
      domainId: ["1", "2"],
      startDate: undefined,
    });
    const { url } = requestOf(fetchMock);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.getAll("domainId")).toEqual(["1", "2"]);
    expect(url.searchParams.has("startDate")).toBe(false);
  });

  test("builds nested contact routes", async () => {
    const fetchMock = mockFetch(200, { contactId: "contact_1" });
    await api.contacts.upsert("book_1", "contact_1", { email: "a@b.com" });
    const { url, init } = requestOf(fetchMock);
    expect(url.pathname).toBe("/api/v1/contactBooks/book_1/contacts/contact_1");
    expect(init.method).toBe("PUT");
  });

  test("sends a body on bulk contact deletes", async () => {
    const fetchMock = mockFetch(200, { success: true, count: 2 });
    await api.contacts.bulkDelete("book_1", ["c1", "c2"]);
    const { url, init } = requestOf(fetchMock);
    expect(url.pathname).toBe("/api/v1/contactBooks/book_1/contacts/bulk");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({
      contactIds: ["c1", "c2"],
    });
  });

  test("returns the parsed response body", async () => {
    mockFetch(200, {
      delivered: 100,
      hardBounced: 1,
      complained: 0,
      bounceRate: 0.01,
      complaintRate: 0,
    });
    const metrics = await api.analytics.reputationMetrics({ domainId: 1 });
    expect(metrics.delivered).toBe(100);
    expect(metrics.bounceRate).toBe(0.01);
  });

  test("throws UseSendApiError with status and body on failure", async () => {
    mockFetch(422, { error: "invalid" });
    const error = await api.campaigns
      .schedule("camp_1", { scheduledAt: "tomorrow 9am" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(UseSendApiError);
    expect((error as UseSendApiError).status).toBe(422);
    expect((error as UseSendApiError).body).toContain("invalid");
  });
});
