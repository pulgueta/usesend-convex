import { afterEach, expect, test, vi } from "vitest";
import { UseSendApi } from "./api.js";
import { initConvexTest } from "../../example/convex/test.setup.js";

function mockJson(body: unknown = {}) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function firstRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  return { url, init };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the action client covers every operation in the useSend OpenAPI spec", async () => {
  const t = initConvexTest();
  const api = new UseSendApi({
    apiKey: "test-api-key",
    baseUrl: "https://usesend.example.com",
  });
  const cases: Array<{
    method: string;
    path: string;
    call: () => Promise<unknown>;
  }> = [
    { method: "GET", path: "/domains", call: () => api.domains.list() },
    {
      method: "POST",
      path: "/domains",
      call: () => api.domains.create("example.com", "us-east-1"),
    },
    { method: "GET", path: "/domains/1", call: () => api.domains.get(1) },
    {
      method: "PUT",
      path: "/domains/1/verify",
      call: () => api.domains.verify(1),
    },
    {
      method: "DELETE",
      path: "/domains/1",
      call: () => api.domains.delete(1),
    },
    {
      method: "POST",
      path: "/emails",
      call: () =>
        api.emails.send({ from: "from@example.com", to: "to@example.com" }),
    },
    {
      method: "POST",
      path: "/emails/batch",
      call: () =>
        api.emails.batch([{ from: "from@example.com", to: "to@example.com" }]),
    },
    {
      method: "GET",
      path: "/emails/email%2F1",
      call: () => api.emails.get("email/1"),
    },
    {
      method: "GET",
      path: "/emails",
      call: () => api.emails.list({ page: 2, limit: 10, domainId: "1" }),
    },
    {
      method: "PATCH",
      path: "/emails/email_1",
      call: () => api.emails.updateSchedule("email_1", "2026-08-01T09:00:00Z"),
    },
    {
      method: "POST",
      path: "/emails/email_1/cancel",
      call: () => api.emails.cancel("email_1"),
    },
    {
      method: "POST",
      path: "/contactBooks/book_1/contacts",
      call: () => api.contacts.create("book_1", { email: "to@example.com" }),
    },
    {
      method: "GET",
      path: "/contactBooks/book_1/contacts/contact_1",
      call: () => api.contacts.get("book_1", "contact_1"),
    },
    {
      method: "GET",
      path: "/contactBooks/book_1/contacts",
      call: () =>
        api.contacts.list("book_1", {
          emails: "to@example.com",
          ids: "contact_1",
          page: 1,
          limit: 25,
        }),
    },
    {
      method: "PATCH",
      path: "/contactBooks/book_1/contacts/contact_1",
      call: () =>
        api.contacts.update("book_1", "contact_1", { firstName: "Ada" }),
    },
    {
      method: "PUT",
      path: "/contactBooks/book_1/contacts/contact_1",
      call: () =>
        api.contacts.upsert("book_1", "contact_1", {
          email: "to@example.com",
        }),
    },
    {
      method: "DELETE",
      path: "/contactBooks/book_1/contacts/contact_1",
      call: () => api.contacts.delete("book_1", "contact_1"),
    },
    {
      method: "POST",
      path: "/contactBooks/book_1/contacts/bulk",
      call: () =>
        api.contacts.bulkCreate("book_1", [{ email: "to@example.com" }]),
    },
    {
      method: "DELETE",
      path: "/contactBooks/book_1/contacts/bulk",
      call: () => api.contacts.bulkDelete("book_1", ["contact_1"]),
    },
    {
      method: "GET",
      path: "/contactBooks",
      call: () => api.contactBooks.list(),
    },
    {
      method: "POST",
      path: "/contactBooks",
      call: () => api.contactBooks.create({ name: "Customers" }),
    },
    {
      method: "GET",
      path: "/contactBooks/book_1",
      call: () => api.contactBooks.get("book_1"),
    },
    {
      method: "PATCH",
      path: "/contactBooks/book_1",
      call: () => api.contactBooks.update("book_1", { name: "Leads" }),
    },
    {
      method: "DELETE",
      path: "/contactBooks/book_1",
      call: () => api.contactBooks.delete("book_1"),
    },
    {
      method: "POST",
      path: "/campaigns",
      call: () =>
        api.campaigns.create({
          name: "Launch",
          from: "from@example.com",
          subject: "Hello",
          contactBookId: "book_1",
        }),
    },
    {
      method: "GET",
      path: "/campaigns",
      call: () => api.campaigns.list({ page: 1, status: "DRAFT" }),
    },
    {
      method: "GET",
      path: "/campaigns/campaign_1",
      call: () => api.campaigns.get("campaign_1"),
    },
    {
      method: "DELETE",
      path: "/campaigns/campaign_1",
      call: () => api.campaigns.delete("campaign_1"),
    },
    {
      method: "POST",
      path: "/campaigns/campaign_1/schedule",
      call: () => api.campaigns.schedule("campaign_1", { batchSize: 100 }),
    },
    {
      method: "POST",
      path: "/campaigns/campaign_1/pause",
      call: () => api.campaigns.pause("campaign_1"),
    },
    {
      method: "POST",
      path: "/campaigns/campaign_1/resume",
      call: () => api.campaigns.resume("campaign_1"),
    },
    {
      method: "GET",
      path: "/analytics/email-time-series",
      call: () => api.analytics.emailTimeSeries({ days: 30, domainId: 1 }),
    },
    {
      method: "GET",
      path: "/analytics/reputation-metrics",
      call: () => api.analytics.reputationMetrics({ domainId: 1 }),
    },
  ];

  for (const operation of cases) {
    const fetchMock = mockJson();
    await t.action(async () => {
      await operation.call();
      return null;
    });
    const { url, init } = firstRequest(fetchMock);
    expect(init.method).toBe(operation.method);
    expect(url.pathname).toBe(`/api/v1${operation.path}`);
    vi.unstubAllGlobals();
  }
});

test("the action client matches useSend headers, scalar selectors, and bodies", async () => {
  const t = initConvexTest();
  const api = new UseSendApi({
    apiKey: "test-api-key",
    baseUrl: "https://usesend.example.com",
  });
  const fetchMock = mockJson({ emailId: "email_1" });

  await t.action(async () => {
    await api.emails.send(
      {
        from: "from@example.com",
        to: ["to@example.com"],
        templateId: "template_1",
        variables: { name: "Ada" },
      },
      { idempotencyKey: "signup-1" },
    );
    return null;
  });

  const { init } = firstRequest(fetchMock);
  expect(init.headers).toMatchObject({
    Authorization: "Bearer test-api-key",
    "Content-Type": "application/json",
    "Idempotency-Key": "signup-1",
  });
  expect(JSON.parse(init.body as string)).toMatchObject({
    templateId: "template_1",
    variables: { name: "Ada" },
  });

  vi.unstubAllGlobals();
  const queryFetch = mockJson([]);
  await t.action(async () => {
    await api.contacts.list("book_1", {
      emails: "ada@example.com",
      ids: "contact_1",
      page: 2,
      limit: 10,
    });
    return null;
  });
  const { url } = firstRequest(queryFetch);
  expect(url.searchParams.get("emails")).toBe("ada@example.com");
  expect(url.searchParams.get("ids")).toBe("contact_1");
  expect(url.searchParams.get("page")).toBe("2");
  expect(url.searchParams.get("limit")).toBe("10");
});

test("the action client rejects unsafe paths and reports provider errors", async () => {
  const t = initConvexTest();
  const api = new UseSendApi({ apiKey: "test-api-key" });
  const fetchMock = mockJson();

  await expect(
    t.action(async () => {
      await api.contactBooks.get("..");
      return null;
    }),
  ).rejects.toThrow("API resource ID cannot be a dot segment");
  expect(fetchMock).not.toHaveBeenCalled();

  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid" }), { status: 422 }),
      ),
  );
  const error = await t.action(async () => {
    try {
      await api.campaigns.schedule("campaign_1", {
        scheduledAt: "tomorrow 9am",
      });
      return null;
    } catch (value) {
      const candidate = value as { name: string; status: number; body: string };
      return {
        name: candidate.name,
        status: candidate.status,
        body: candidate.body,
      };
    }
  });
  expect(error).toMatchObject({
    name: "UseSendApiError",
    status: 422,
    body: expect.stringContaining("invalid"),
  });
});

test("the action client enforces API keys and request timeouts", async () => {
  const t = initConvexTest();
  await expect(
    t.action(async () => {
      new UseSendApi({ apiKey: "" });
      return null;
    }),
  ).rejects.toThrow("API key is not set");
  await expect(
    t.action(async () => {
      new UseSendApi({ apiKey: "key", requestTimeoutMs: 0 });
      return null;
    }),
  ).rejects.toThrow("Request timeout must be a positive finite number");

  vi.useFakeTimers();
  const fetchMock = vi.fn(
    (_url: URL, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const api = new UseSendApi({ apiKey: "key", requestTimeoutMs: 50 });
  const request = t.action(async () => {
    await api.domains.list();
    return null;
  });
  const rejection = expect(request).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.advanceTimersByTimeAsync(50);
  await rejection;
  expect((firstRequest(fetchMock).init.signal as AbortSignal).aborted).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
});
