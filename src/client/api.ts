/**
 * A typed client for the useSend REST API (https://docs.usesend.com/api-reference).
 *
 * The durable email pipeline (batching, retries, webhook status tracking) lives
 * in the Convex component. This client covers everything else the API offers:
 * contacts, contact books, domains, campaigns, analytics, and direct email
 * operations (scheduling, attachments, listing).
 *
 * All methods perform network calls, so they can only be used inside Convex
 * actions (or any environment with `fetch`), not queries or mutations.
 */

export class UseSendApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string,
  ) {
    super(`useSend API error: ${method} ${path} ${status} ${body}`);
    this.name = "UseSendApiError";
  }
}

type QueryValue = string | number | string[] | undefined;

/* Emails */

export type ApiEmailStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "SENT"
  | "DELIVERY_DELAYED"
  | "BOUNCED"
  | "REJECTED"
  | "RENDERING_FAILURE"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "COMPLAINED"
  | "FAILED"
  | "CANCELLED"
  | "SUPPRESSED";

export type EmailAttachment = {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
};

export type SendEmailRequest = {
  to: string | string[];
  from: string;
  /** Optional when templateId is provided. */
  subject?: string;
  /** ID of a template from the useSend dashboard. */
  templateId?: string;
  /** Variables to substitute into the template. */
  variables?: Record<string, string>;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  /** Up to 10 attachments. */
  attachments?: EmailAttachment[];
  /** ISO 8601 timestamp to schedule delivery. */
  scheduledAt?: string;
  inReplyToId?: string;
};

export type EmailSummary = {
  id: string;
  to: string | string[];
  replyTo?: string | string[] | null;
  cc?: string | string[] | null;
  bcc?: string | string[] | null;
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  latestStatus: ApiEmailStatus | null;
  scheduledAt: string | null;
  domainId: number | null;
};

export type EmailDetail = {
  id: string;
  teamId: number;
  to: string | string[];
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  from: string;
  subject: string;
  html: string | null;
  text: string | null;
  createdAt: string;
  updatedAt: string;
  emailEvents: Array<{
    emailId: string;
    status: ApiEmailStatus;
    createdAt: string;
    data?: unknown;
  }>;
};

export type ListEmailsParams = {
  page?: number;
  limit?: number;
  /** ISO 8601 timestamp. */
  startDate?: string;
  /** ISO 8601 timestamp. */
  endDate?: string;
  domainId?: string | string[];
};

/* Contacts */

export type Contact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  subscribed?: boolean;
  properties: Record<string, string>;
  contactBookId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateContactRequest = {
  email: string;
  firstName?: string;
  lastName?: string;
  properties?: Record<string, string>;
  subscribed?: boolean;
};

export type UpdateContactRequest = Omit<CreateContactRequest, "email">;

export type ListContactsParams = {
  emails?: string | string[];
  ids?: string | string[];
  page?: number;
  limit?: number;
};

/* Contact books */

export type ContactBook = {
  id: string;
  name: string;
  teamId: number;
  properties: Record<string, string>;
  /** Allowed personalization variables for contacts in this book. */
  variables?: string[];
  emoji?: string;
  doubleOptInEnabled?: boolean;
  doubleOptInFrom?: string | null;
  doubleOptInSubject?: string | null;
  doubleOptInContent?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateContactBookRequest = {
  name: string;
  emoji?: string;
  properties?: Record<string, string>;
  doubleOptInEnabled?: boolean;
  doubleOptInFrom?: string | null;
  doubleOptInSubject?: string;
  doubleOptInContent?: string;
  variables?: string[];
};

export type UpdateContactBookRequest = Partial<CreateContactBookRequest>;

/* Domains */

export type DomainStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "TEMPORARY_FAILURE";

export type Domain = {
  id: number;
  name: string;
  teamId: number;
  status: DomainStatus;
  region: string;
  clickTracking: boolean;
  openTracking: boolean;
  publicKey: string;
  dkimStatus?: string | null;
  spfDetails?: string | null;
  createdAt: string;
  updatedAt: string;
  dmarcAdded: boolean;
  isVerifying: boolean;
  errorMessage?: string | null;
  subdomain?: string | null;
  verificationError?: string | null;
  lastCheckedTime?: string | null;
  dnsRecords?: Array<{
    type: string;
    name: string;
    value: string;
    ttl?: string;
    priority?: number;
    status?: string;
  }>;
};

/* Campaigns */

export type Campaign = {
  id: string;
  name: string;
  from: string;
  subject: string;
  previewText: string | null;
  contactBookId: string | null;
  html: string | null;
  content: string | null;
  status: string;
  scheduledAt: string | null;
  batchSize: number;
  batchWindowMinutes: number;
  total: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  hardBounced: number;
  complained: number;
  replyTo: string[];
  cc: string[];
  bcc: string[];
  createdAt: string;
  updatedAt: string;
};

export type CampaignSummary = {
  id: string;
  name: string;
  from: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  scheduledAt: string | null;
  total: number;
  sent: number;
  delivered: number;
  unsubscribed: number;
};

export type CreateCampaignRequest = {
  name: string;
  from: string;
  subject: string;
  contactBookId: string;
  previewText?: string;
  content?: string;
  html?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  sendNow?: boolean;
  /** ISO 8601 timestamp or natural language (e.g. "tomorrow 9am"). */
  scheduledAt?: string;
  batchSize?: number;
};

export type ListCampaignsParams = {
  page?: number;
  status?: string;
  search?: string;
};

export type ScheduleCampaignRequest = {
  /** ISO 8601 timestamp or natural language (e.g. "tomorrow 9am"). */
  scheduledAt?: string;
  batchSize?: number;
};

/* Analytics */

export type EmailTimeSeriesCounts = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
};

export type EmailTimeSeries = {
  result: Array<{ date: string } & EmailTimeSeriesCounts>;
  totalCounts: EmailTimeSeriesCounts;
};

export type ReputationMetrics = {
  delivered: number;
  hardBounced: number;
  complained: number;
  bounceRate: number;
  complaintRate: number;
};

export class UseSendApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    if (options.apiKey === "") {
      throw new Error("API key is not set");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://app.usesend.com";
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      query?: Record<string, QueryValue>;
      body?: unknown;
      idempotencyKey?: string;
    },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(options?.query ?? {})) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, String(item));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (options?.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new UseSendApiError(
        response.status,
        await response.text(),
        method,
        path,
      );
    }
    return (await response.json()) as T;
  }

  readonly emails = {
    /**
     * Sends a single email directly, bypassing the component's durable
     * batching. Supports attachments and scheduling. Combine with
     * `UseSend.sendEmailManually` if you want the component to track it.
     */
    send: (email: SendEmailRequest, options?: { idempotencyKey?: string }) =>
      this.request<{ emailId: string }>("POST", "/emails", {
        body: email,
        idempotencyKey: options?.idempotencyKey,
      }),

    /** Sends up to 100 emails in a single request. */
    batch: (
      emails: SendEmailRequest[],
      options?: { idempotencyKey?: string },
    ) =>
      this.request<{ data: Array<{ emailId: string }> }>(
        "POST",
        "/emails/batch",
        { body: emails, idempotencyKey: options?.idempotencyKey },
      ),

    /** Retrieves an email with its full event history. */
    get: (emailId: string) =>
      this.request<EmailDetail>("GET", `/emails/${emailId}`),

    list: (params?: ListEmailsParams) =>
      this.request<{ data: EmailSummary[]; count: number }>("GET", "/emails", {
        query: { ...params },
      }),

    /** Reschedules a scheduled email. */
    updateSchedule: (emailId: string, scheduledAt: string) =>
      this.request<{ emailId: string }>("PATCH", `/emails/${emailId}`, {
        body: { scheduledAt },
      }),

    /** Cancels a scheduled email. */
    cancel: (emailId: string) =>
      this.request<{ emailId: string }>("POST", `/emails/${emailId}/cancel`),
  };

  readonly contacts = {
    create: (contactBookId: string, contact: CreateContactRequest) =>
      this.request<{ contactId: string }>(
        "POST",
        `/contactBooks/${contactBookId}/contacts`,
        { body: contact },
      ),

    get: (contactBookId: string, contactId: string) =>
      this.request<Contact>(
        "GET",
        `/contactBooks/${contactBookId}/contacts/${contactId}`,
      ),

    list: (contactBookId: string, params?: ListContactsParams) =>
      this.request<Contact[]>(
        "GET",
        `/contactBooks/${contactBookId}/contacts`,
        { query: { ...params } },
      ),

    update: (
      contactBookId: string,
      contactId: string,
      updates: UpdateContactRequest,
    ) =>
      this.request<{ contactId: string }>(
        "PATCH",
        `/contactBooks/${contactBookId}/contacts/${contactId}`,
        { body: updates },
      ),

    /** Creates the contact if it doesn't exist, updates it otherwise. */
    upsert: (
      contactBookId: string,
      contactId: string,
      contact: CreateContactRequest,
    ) =>
      this.request<{ contactId: string }>(
        "PUT",
        `/contactBooks/${contactBookId}/contacts/${contactId}`,
        { body: contact },
      ),

    delete: (contactBookId: string, contactId: string) =>
      this.request<{ success: boolean }>(
        "DELETE",
        `/contactBooks/${contactBookId}/contacts/${contactId}`,
      ),

    /** Creates up to 1000 contacts in a single request. */
    bulkCreate: (contactBookId: string, contacts: CreateContactRequest[]) =>
      this.request<{ message: string; count: number }>(
        "POST",
        `/contactBooks/${contactBookId}/contacts/bulk`,
        { body: contacts },
      ),

    /** Deletes up to 1000 contacts in a single request. */
    bulkDelete: (contactBookId: string, contactIds: string[]) =>
      this.request<{ success: boolean; count: number }>(
        "DELETE",
        `/contactBooks/${contactBookId}/contacts/bulk`,
        { body: { contactIds } },
      ),
  };

  readonly contactBooks = {
    create: (contactBook: CreateContactBookRequest) =>
      this.request<ContactBook>("POST", "/contactBooks", {
        body: contactBook,
      }),

    get: (contactBookId: string) =>
      this.request<ContactBook>("GET", `/contactBooks/${contactBookId}`),

    list: () => this.request<ContactBook[]>("GET", "/contactBooks"),

    update: (contactBookId: string, updates: UpdateContactBookRequest) =>
      this.request<ContactBook>("PATCH", `/contactBooks/${contactBookId}`, {
        body: updates,
      }),

    delete: (contactBookId: string) =>
      this.request<{ id: string; success: boolean; message: string }>(
        "DELETE",
        `/contactBooks/${contactBookId}`,
      ),
  };

  readonly domains = {
    create: (name: string, region: string) =>
      this.request<Domain>("POST", "/domains", { body: { name, region } }),

    get: (domainId: number) =>
      this.request<Domain>("GET", `/domains/${domainId}`),

    list: () => this.request<Domain[]>("GET", "/domains"),

    /** Triggers DNS verification for the domain. */
    verify: (domainId: number) =>
      this.request<{ message: string }>("PUT", `/domains/${domainId}/verify`),

    delete: (domainId: number) =>
      this.request<{ id: number; success: boolean; message: string }>(
        "DELETE",
        `/domains/${domainId}`,
      ),
  };

  readonly campaigns = {
    create: (campaign: CreateCampaignRequest) =>
      this.request<Campaign>("POST", "/campaigns", { body: campaign }),

    get: (campaignId: string) =>
      this.request<Campaign>("GET", `/campaigns/${campaignId}`),

    list: (params?: ListCampaignsParams) =>
      this.request<{ campaigns: CampaignSummary[]; totalPage: number }>(
        "GET",
        "/campaigns",
        { query: { ...params } },
      ),

    delete: (campaignId: string) =>
      this.request<Campaign>("DELETE", `/campaigns/${campaignId}`),

    /** Schedules the campaign, or sends immediately when no time is given. */
    schedule: (campaignId: string, options?: ScheduleCampaignRequest) =>
      this.request<{ success: boolean }>(
        "POST",
        `/campaigns/${campaignId}/schedule`,
        { body: options ?? {} },
      ),

    pause: (campaignId: string) =>
      this.request<{ success: boolean }>(
        "POST",
        `/campaigns/${campaignId}/pause`,
      ),

    resume: (campaignId: string) =>
      this.request<{ success: boolean }>(
        "POST",
        `/campaigns/${campaignId}/resume`,
      ),
  };

  readonly analytics = {
    emailTimeSeries: (params?: { days?: number; domainId?: number }) =>
      this.request<EmailTimeSeries>("GET", "/analytics/email-time-series", {
        query: { days: params?.days, domainId: params?.domainId },
      }),

    reputationMetrics: (params?: { domainId?: number }) =>
      this.request<ReputationMetrics>("GET", "/analytics/reputation-metrics", {
        query: { domainId: params?.domainId },
      }),
  };
}
