import { v } from "convex/values";
import {
  env,
  internalAction,
  mutation,
  type MutationCtx,
  query,
  internalQuery,
  type ActionCtx,
} from "./_generated/server.js";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { api, components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { type Id, type Doc } from "./_generated/dataModel.js";
import {
  type RuntimeConfig,
  vEmailEvent,
  vOptions,
  vStatus,
  vTemplate,
} from "./shared.js";
import type { FunctionHandle } from "convex/server";
import type { EmailEvent, RunMutationCtx, RunQueryCtx } from "./shared.js";
import { paginator } from "convex-helpers/server/pagination";
import { attemptToParse } from "./utils.js";
import { computeEmailUpdateFromEvent, FINALIZED_EPOCH } from "./events.js";
import { parseBatchResponse, runtimeConfigKey } from "./batch.js";
import schema from "./schema.js";

// Configuration constants
const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 1000;
const BATCH_SIZE = 100;
const EMAIL_POOL_SIZE = 4;
const CALLBACK_POOL_SIZE = 4;
const USESEND_ONE_CALL_EVERY_MS = 600;
const FINALIZED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const ABANDONED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const WEBHOOK_RETRY_DELAY_MS = 1000;
const MAX_WEBHOOK_RETRY_ATTEMPTS = 6;
const WEBHOOK_RETRY_MAX_DELAY_MS = 30_000;
const ABANDONED_STATUSES: Array<"waiting" | "queued"> = ["waiting", "queued"];

const PERMANENT_ERROR_CODES = new Set([
  400, 401, 403, 404, 405, 406, 407, 410, 411, 413, 414, 415, 416, 418, 422,
  426, 427, 428, 431,
]);

function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
}

function getRetentionAnchor(now: number, scheduledAt?: string) {
  if (scheduledAt === undefined) return now;
  const scheduledTime = Date.parse(scheduledAt);
  return Number.isFinite(scheduledTime) ? Math.max(now, scheduledTime) : now;
}

// Workpools for durable execution
const emailPool = new Workpool(components.emailWorkpool, {
  maxParallelism: EMAIL_POOL_SIZE,
});

const callbackPool = new Workpool(components.callbackWorkpool, {
  maxParallelism: CALLBACK_POOL_SIZE,
});

// Rate limiter for useSend API
const usesendApiRateLimiter = new RateLimiter(components.rateLimiter, {
  usesendApi: {
    kind: "fixed window",
    period: USESEND_ONE_CALL_EVERY_MS,
    rate: 1,
  },
});

// Clean up old finalized emails
export const cleanupOldEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const CLEANUP_BATCH_SIZE = 100;
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const oldAndDone = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan),
      )
      .take(CLEANUP_BATCH_SIZE);
    for (const email of oldAndDone) {
      await cleanupEmail(ctx, email);
    }
    if (oldAndDone.length > 0) {
      console.log(`Cleaned up ${oldAndDone.length} emails`);
    }
    if (oldAndDone.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEmails, {
        olderThan,
      });
    }
  },
});

// Enqueue an email to be sent
export const sendEmail = mutation({
  args: {
    options: vOptions,
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    template: v.optional(vTemplate),
    replyTo: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
    scheduledAt: v.optional(v.string()),
    inReplyToId: v.optional(v.string()),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    // Require either html/text or a template
    const hasContent = args.html !== undefined || args.text !== undefined;
    const hasTemplate = args.template?.id !== undefined;

    if (!hasContent && !hasTemplate) {
      throw new Error("Either html/text or template must be provided");
    }
    if (hasContent && hasTemplate) {
      throw new Error("Cannot provide both html/text and template");
    }
    if (!hasTemplate && args.subject === undefined) {
      throw new Error("Subject is required when not using a template");
    }

    // Store content separately to keep email records small
    let htmlContentId: Id<"content"> | undefined;
    if (args.html !== undefined) {
      htmlContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.html).buffer,
        mimeType: "text/html",
      });
    }

    let textContentId: Id<"content"> | undefined;
    if (args.text !== undefined) {
      textContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.text).buffer,
        mimeType: "text/plain",
      });
    }

    const now = Date.now();
    const segment = getSegment(now);

    const emailId = await ctx.db.insert("emails", {
      options: args.options,
      from: args.from,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      html: htmlContentId,
      text: textContentId,
      template: args.template,
      headers: args.headers,
      scheduledAt: args.scheduledAt,
      inReplyToId: args.inReplyToId,
      segment,
      status: "waiting",
      bounced: false,
      complained: false,
      failed: false,
      deliveryDelayed: false,
      opened: false,
      clicked: false,
      replyTo: args.replyTo ?? [],
      retentionAnchor: getRetentionAnchor(now, args.scheduledAt),
      finalizedAt: FINALIZED_EPOCH,
    });

    await scheduleBatchRun(ctx);
    return emailId;
  },
});

// Create a manual email entry (for direct API calls)
export const createManualEmail = mutation({
  args: {
    options: vOptions,
    from: v.string(),
    to: v.union(v.array(v.string()), v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    replyTo: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const emailId = await ctx.db.insert("emails", {
      options: args.options,
      from: args.from,
      to: Array.isArray(args.to) ? args.to : [args.to],
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      headers: args.headers,
      segment: Infinity,
      status: "queued",
      bounced: false,
      complained: false,
      failed: false,
      deliveryDelayed: false,
      opened: false,
      clicked: false,
      replyTo: args.replyTo ?? [],
      retentionAnchor: now,
      finalizedAt: FINALIZED_EPOCH,
    });
    return emailId;
  },
});

// Update manual email status
export const updateManualEmail = mutation({
  args: {
    emailId: v.id("emails"),
    status: vStatus,
    usesendId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finalizedAt =
      args.status === "failed" || args.status === "cancelled"
        ? Date.now()
        : undefined;
    await ctx.db.patch(args.emailId, {
      status: args.status,
      usesendId: args.usesendId,
      errorMessage: args.errorMessage,
      ...(args.status === "failed" ? { failed: true } : {}),
      ...(finalizedAt ? { finalizedAt } : {}),
    });
  },
});

// Cancel an email
export const cancelEmail = mutation({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      throw new Error("Email not found");
    }
    if (email.status !== "waiting") {
      throw new Error("Email has already been sent");
    }
    await ctx.db.patch(args.emailId, {
      status: "cancelled",
      finalizedAt: Date.now(),
    });
  },
});

// Get email status
export const getStatus = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      status: vStatus,
      errorMessage: v.union(v.string(), v.null()),
      bounced: v.boolean(),
      complained: v.boolean(),
      failed: v.boolean(),
      deliveryDelayed: v.boolean(),
      opened: v.boolean(),
      clicked: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }
    return {
      status: email.status,
      errorMessage: email.errorMessage ?? null,
      bounced: email.bounced ?? false,
      complained: email.complained,
      failed: email.failed ?? false,
      deliveryDelayed: email.deliveryDelayed ?? false,
      opened: email.opened,
      clicked: email.clicked ?? false,
    };
  },
});

// Get full email details
export const get = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      from: v.string(),
      to: v.array(v.string()),
      cc: v.optional(v.array(v.string())),
      bcc: v.optional(v.array(v.string())),
      subject: v.optional(v.string()),
      replyTo: v.array(v.string()),
      headers: v.optional(v.record(v.string(), v.string())),
      status: vStatus,
      errorMessage: v.optional(v.string()),
      bounced: v.optional(v.boolean()),
      complained: v.boolean(),
      failed: v.optional(v.boolean()),
      deliveryDelayed: v.optional(v.boolean()),
      opened: v.boolean(),
      clicked: v.optional(v.boolean()),
      usesendId: v.optional(v.string()),
      finalizedAt: v.number(),
      createdAt: v.number(),
      html: v.optional(v.string()),
      text: v.optional(v.string()),
      template: v.optional(vTemplate),
      scheduledAt: v.optional(v.string()),
      inReplyToId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }
    const html = email.html
      ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
      : undefined;
    const text = email.text
      ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
      : undefined;
    return {
      from: email.from,
      to: Array.isArray(email.to) ? email.to : [email.to],
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      replyTo: email.replyTo,
      headers: email.headers,
      status: email.status,
      errorMessage: email.errorMessage,
      bounced: email.bounced,
      complained: email.complained,
      failed: email.failed,
      deliveryDelayed: email.deliveryDelayed,
      opened: email.opened,
      clicked: email.clicked,
      usesendId: email.usesendId,
      finalizedAt: email.finalizedAt,
      createdAt: email._creationTime,
      html,
      text,
      template: email.template,
      scheduledAt: email.scheduledAt,
      inReplyToId: email.inReplyToId,
    };
  },
});

// Schedule batch processing
async function scheduleBatchRun(ctx: MutationCtx) {
  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    const scheduled = await ctx.db.system.get(
      "_scheduled_functions",
      existing.runId,
    );
    if (
      scheduled?.state.kind === "pending" ||
      scheduled?.state.kind === "inProgress"
    ) {
      return;
    }
    await ctx.db.delete(existing._id);
  }

  await replaceBatchRun(ctx, BASE_BATCH_DELAY, {
    reloop: false,
    segment: getSegment(Date.now() + BASE_BATCH_DELAY),
  });
}

async function replaceBatchRun(
  ctx: MutationCtx,
  delay: number,
  args: { reloop: boolean; segment: number },
) {
  const runId = await ctx.scheduler.runAfter(
    delay,
    internal.lib.makeBatch,
    args,
  );
  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    await ctx.db.patch(existing._id, { runId });
  } else {
    await ctx.db.insert("nextBatchRun", { runId });
  }
}

async function enqueueBatch(
  ctx: MutationCtx,
  emails: Doc<"emails">[],
  options: RuntimeConfig,
) {
  const delay = await getDelay(ctx);
  await emailPool.enqueueAction(
    ctx,
    internal.lib.callUseSendAPIWithBatch,
    {
      baseUrl: options.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
      emails: emails.map((email) => email._id),
    },
    {
      retry: {
        maxAttempts: options.retryAttempts,
        initialBackoffMs: options.initialBackoffMs,
        base: 2,
      },
      runAfter: delay,
      context: { emailIds: emails.map((email) => email._id) },
      onComplete: internal.lib.onEmailComplete,
    },
  );

  for (const email of emails) {
    await ctx.db.patch(email._id, { status: "queued" });
  }
}

// Process email batches
export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) =>
        q.eq("status", "waiting").lte("segment", args.segment - 2),
      )
      .take(BATCH_SIZE);

    if (emails.length === 0 || (args.reloop && emails.length < BATCH_SIZE)) {
      return reschedule(ctx, emails.length > 0);
    }

    console.log(`Making a batch of ${emails.length} emails`);

    const batches = new Map<
      string,
      { options: RuntimeConfig; emails: Doc<"emails">[] }
    >();
    for (const email of emails) {
      const key = runtimeConfigKey(email.options);
      const batch = batches.get(key);
      if (batch) {
        batch.emails.push(email);
      } else {
        batches.set(key, { options: email.options, emails: [email] });
      }
    }

    try {
      for (const batch of batches.values()) {
        await enqueueBatch(ctx, batch.emails, batch.options);
      }
    } catch {
      await reschedule(ctx, true);
      return null;
    }

    await replaceBatchRun(ctx, 0, {
      reloop: true,
      segment: args.segment,
    });
  },
});

async function reschedule(ctx: MutationCtx, emailsLeft: boolean) {
  emailsLeft =
    emailsLeft ||
    (await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) => q.eq("status", "waiting"))
      .first()) !== null;

  if (!emailsLeft) {
    const batchRun = await ctx.db.query("nextBatchRun").unique();
    if (batchRun) {
      await ctx.db.delete(batchRun._id);
    }
  } else {
    await replaceBatchRun(ctx, BASE_BATCH_DELAY, {
      reloop: false,
      segment: getSegment(Date.now() + BASE_BATCH_DELAY),
    });
  }
}

// Fetch content by IDs
async function getAllContent(
  ctx: ActionCtx,
  contentIds: Id<"content">[],
): Promise<Map<Id<"content">, string>> {
  const docs = await ctx.runQuery(internal.lib.getAllContentByIds, {
    contentIds,
  });
  return new Map(docs.map((doc) => [doc.id, doc.content]));
}

// Call useSend batch API. The API key is resolved from the component's
// environment at execution time so the credential only ever lives in
// deployment secret storage, never in component documents or function args.
export const callUseSendAPIWithBatch = internalAction({
  args: {
    // Deprecated and ignored: accepted only so workpool jobs enqueued by
    // <= 0.1.1 (whose persisted args still carry the key) pass validation
    // while they drain after an upgrade. The env binding below is always
    // the credential actually used.
    apiKey: v.optional(v.string()),
    baseUrl: v.string(),
    requestTimeoutMs: v.number(),
    emails: v.array(v.id("emails")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = env.USESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "USESEND_API_KEY is not set for the usesend component. Bind it in " +
          "convex.config.ts: app.use(usesend, { env: { USESEND_API_KEY: ... } })",
      );
    }
    // The optional USESEND_BASE_URL component binding, when set, is the
    // deployment-level source of truth; otherwise use the client-provided
    // per-instance base URL.
    const baseUrl = env.USESEND_BASE_URL || args.baseUrl;

    const batchPayload = await createUseSendBatchPayload(
      ctx,
      args.emails,
      apiKey,
    );

    if (batchPayload === null) {
      console.log("No emails to send in batch. All were cancelled or failed.");
      return null;
    }

    const [emailIds, body] = batchPayload;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/emails/batch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": args.emails[0].toString(),
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (PERMANENT_ERROR_CODES.has(response.status)) {
        await ctx.runMutation(internal.lib.markEmailsFailed, {
          emailIds: args.emails,
          errorMessage: `useSend API error: ${response.status} ${response.statusText} ${await response.text()}`,
        });
        return null;
      }
      const errorText = await response.text();
      throw new Error(`useSend API error: ${errorText}`);
    }

    // useSend returns batch results in request order; validate the complete
    // ordered response before persisting any mapping.
    const usesendIds = parseBatchResponse(
      await response.json(),
      emailIds.length,
    );

    await ctx.runMutation(internal.lib.recordBatchAccepted, {
      mappings: emailIds.map((emailId, index) => ({
        emailId,
        usesendId: usesendIds[index],
      })),
    });
    return null;
  },
});

export const recordBatchAccepted = internalMutation({
  args: {
    mappings: v.array(
      v.object({ emailId: v.id("emails"), usesendId: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const { emailId, usesendId } of args.mappings) {
      const [email, existingMapping] = await Promise.all([
        ctx.db.get(emailId),
        ctx.db
          .query("emails")
          .withIndex("by_usesendId", (q) => q.eq("usesendId", usesendId))
          .unique(),
      ]);
      if (!email) {
        throw new Error(`Email ${emailId} no longer exists`);
      }
      if (existingMapping && existingMapping._id !== emailId) {
        throw new Error(`useSend email ID ${usesendId} is already mapped`);
      }
      const status = email.status === "queued" ? "sent" : undefined;
      await ctx.db.patch(emailId, {
        usesendId,
        ...(status ? { status } : {}),
      });
    }
    return null;
  },
});

export const markEmailsFailed = internalMutation({
  args: {
    emailIds: v.array(v.id("emails")),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: markEmailsFailedHandler,
});

async function markEmailsFailedHandler(
  ctx: MutationCtx,
  args: {
    emailIds: Id<"emails">[];
    errorMessage: string;
  },
) {
  await Promise.all(
    args.emailIds.map(async (emailId) => {
      const email = await ctx.db.get(emailId);
      if (!email || email.status !== "queued") {
        return;
      }
      await ctx.db.patch(emailId, {
        status: "failed",
        failed: true,
        errorMessage: args.errorMessage,
        finalizedAt: Date.now(),
      });
    }),
  );
}

export const onEmailComplete = emailPool.defineOnComplete({
  context: v.object({
    emailIds: v.array(v.id("emails")),
  }),
  handler: async (ctx, args) => {
    if (args.result.kind === "success") {
      return;
    } else if (args.result.kind === "failed") {
      await markEmailsFailedHandler(ctx, {
        emailIds: args.context.emailIds,
        errorMessage: args.result.error,
      });
    } else if (args.result.kind === "canceled") {
      await Promise.all(
        args.context.emailIds.map(async (emailId) => {
          const email = await ctx.db.get(emailId);
          if (!email || email.status !== "queued") {
            return;
          }
          await ctx.db.patch(emailId, {
            status: "cancelled",
            errorMessage: "useSend API batch job was cancelled",
            finalizedAt: Date.now(),
          });
        }),
      );
    }
  },
});

// Create batch payload for useSend API
async function createUseSendBatchPayload(
  ctx: ActionCtx,
  emailIds: Id<"emails">[],
  apiKey: string,
): Promise<[Id<"emails">[], string] | null> {
  const allEmails = await ctx.runQuery(internal.lib.getEmailsByIds, {
    emailIds,
  });
  const queued = allEmails.filter((e) => e.status === "queued");
  // Rows enqueued by <= 0.1.1 may still carry a stored per-instance key. If
  // it matches the bound credential the email drains normally; if not,
  // sending it with the env credential could deliver through the wrong
  // useSend account, so fail it explicitly instead.
  const mismatched = queued.filter(
    (e) => e.options.apiKey !== undefined && e.options.apiKey !== apiKey,
  );
  if (mismatched.length > 0) {
    await ctx.runMutation(internal.lib.markEmailsFailed, {
      emailIds: mismatched.map((e) => e._id),
      errorMessage:
        "Email was enqueued by a previous component version with an API key " +
        "that does not match the component's USESEND_API_KEY binding. " +
        "Re-enqueue it with current credentials.",
    });
  }
  const emails = queued.filter(
    (e) => e.options.apiKey === undefined || e.options.apiKey === apiKey,
  );
  if (emails.length === 0) {
    return null;
  }

  const contentMap = await getAllContent(
    ctx,
    emails
      .flatMap((e) => [e.html, e.text])
      .filter((id): id is Id<"content"> => id !== undefined),
  );

  const batchPayload = emails.map((email: Doc<"emails">) => {
    const payload: Record<string, unknown> = {
      from: email.from,
      to: Array.isArray(email.to) ? email.to : [email.to],
      bcc: email.bcc,
      cc: email.cc,
      replyTo: email.replyTo?.length ? email.replyTo : undefined,
      headers: email.headers,
      scheduledAt: email.scheduledAt,
      inReplyToId: email.inReplyToId,
    };

    if (email.template) {
      payload.templateId = email.template.id;
      // The useSend batch API only accepts string variable values; numbers
      // are allowed at the client boundary for convenience.
      payload.variables =
        email.template.variables &&
        Object.fromEntries(
          Object.entries(email.template.variables).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
      if (email.subject) {
        payload.subject = email.subject;
      }
    } else {
      payload.subject = email.subject;
      payload.html = email.html ? contentMap.get(email.html) : undefined;
      payload.text = email.text ? contentMap.get(email.text) : undefined;
    }

    return payload;
  });

  return [emails.map((e) => e._id), JSON.stringify(batchPayload)];
}

const FIXED_WINDOW_DELAY = 100;
async function getDelay(ctx: RunMutationCtx & RunQueryCtx): Promise<number> {
  const limit = await usesendApiRateLimiter.limit(ctx, "usesendApi", {
    reserve: true,
  });
  const jitter = Math.random() * FIXED_WINDOW_DELAY;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
}

// Helper queries
export const getAllContentByIds = internalQuery({
  args: { contentIds: v.array(v.id("content")) },
  returns: v.array(v.object({ id: v.id("content"), content: v.string() })),
  handler: async (ctx, args) => {
    const contentMap = [];
    const promises = [];
    for (const contentId of args.contentIds) {
      promises.push(ctx.db.get(contentId));
    }
    const docs = await Promise.all(promises);
    for (const doc of docs) {
      if (!doc) throw new Error("Content not found -- invariant");
      contentMap.push({
        id: doc._id,
        content: new TextDecoder().decode(doc.content),
      });
    }
    return contentMap;
  },
});

export const getEmailsByIds = internalQuery({
  args: { emailIds: v.array(v.id("emails")) },
  handler: async (ctx, args) => {
    const emails = await Promise.all(args.emailIds.map((id) => ctx.db.get(id)));
    return emails.filter((e): e is Doc<"emails"> => e !== null);
  },
});

export const getEmailByUseSendId = internalQuery({
  args: { usesendId: v.string() },
  handler: async (ctx, args) => {
    const email = await ctx.db
      .query("emails")
      .withIndex("by_usesendId", (q) => q.eq("usesendId", args.usesendId))
      .unique();
    if (!email) throw new Error("Email not found for usesendId");
    return email;
  },
});

// Handle webhook events
export const handleEmailEvent = mutation({
  args: {
    event: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = attemptToParse(vEmailEvent, args.event);
    if (result.kind === "error") {
      console.warn(
        `Invalid email event received. You might want to exclude this event from your useSend webhook settings. ${result.error}.`,
      );
      return;
    }

    const event = result.data;
    const seenEvent =
      (await ctx.db
        .query("deliveryEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
        .unique()) ??
      (await ctx.db
        .query("pendingEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
        .unique());
    if (seenEvent) return null;

    const email = await ctx.db
      .query("emails")
      .withIndex("by_usesendId", (q) => q.eq("usesendId", event.data.id))
      .unique();

    if (!email) {
      const pendingEventId = await ctx.db.insert("pendingEvents", {
        eventId: event.id,
        usesendId: event.data.id,
        event,
        attempts: 0,
      });
      await ctx.scheduler.runAfter(
        WEBHOOK_RETRY_DELAY_MS,
        internal.lib.retryEmailEvent,
        { pendingEventId },
      );
      return null;
    }

    await processEmailEvent(ctx, email, event);
    return null;
  },
});

export const retryEmailEvent = internalMutation({
  args: { pendingEventId: v.id("pendingEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.pendingEventId);
    if (!pending) return null;

    const email = await ctx.db
      .query("emails")
      .withIndex("by_usesendId", (q) => q.eq("usesendId", pending.usesendId))
      .unique();
    if (email) {
      await processEmailEvent(ctx, email, pending.event);
      await ctx.db.delete(pending._id);
      return null;
    }

    if (pending.attempts + 1 >= MAX_WEBHOOK_RETRY_ATTEMPTS) {
      console.info(
        `Email not found for usesendId: ${pending.usesendId}, discarding unmatched event ${pending.eventId}`,
      );
      await ctx.db.delete(pending._id);
      return null;
    }

    const attempts = pending.attempts + 1;
    await ctx.db.patch(pending._id, { attempts });
    await ctx.scheduler.runAfter(
      Math.min(
        WEBHOOK_RETRY_DELAY_MS * 2 ** attempts,
        WEBHOOK_RETRY_MAX_DELAY_MS,
      ),
      internal.lib.retryEmailEvent,
      { pendingEventId: pending._id },
    );
    return null;
  },
});

async function processEmailEvent(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent,
) {
  await ctx.db.insert("deliveryEvents", {
    eventId: event.id,
    emailId: email._id,
    usesendId: event.data.id,
    eventType: event.type,
    createdAt: event.createdAt,
    message:
      event.type === "email.bounced"
        ? event.data.bounce.message
        : event.type === "email.failed"
          ? event.data.failed.reason
          : undefined,
  });

  const patch = computeEmailUpdateFromEvent(email, event);
  if (patch) {
    await ctx.db.patch(email._id, patch);
  }
  await enqueueCallbackIfExists(ctx, email, event);
}

async function enqueueCallbackIfExists(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent,
) {
  if (email.options.onEmailEvent) {
    const handle = email.options.onEmailEvent.fnHandle as FunctionHandle<
      "mutation",
      {
        id: Id<"emails">;
        event: EmailEvent;
      },
      void
    >;
    await callbackPool.enqueueMutation(ctx, handle, {
      id: email._id,
      event: event,
    });
  }
}

async function cleanupEmail(ctx: MutationCtx, email: Doc<"emails">) {
  await ctx.db.delete(email._id);
  if (email.text) {
    await ctx.db.delete(email.text);
  }
  if (email.html) {
    await ctx.db.delete(email.html);
  }
  const events = await ctx.db
    .query("deliveryEvents")
    .withIndex("by_emailId_eventType", (q) => q.eq("emailId", email._id))
    .collect();
  for (const event of events) {
    await ctx.db.delete(event._id);
  }
}

// Clean up abandoned emails
export const cleanupAbandonedEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const CLEANUP_BATCH_SIZE = 250;
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const cutoff = Date.now() - olderThan;
    const [waiting, queued] = await Promise.all(
      ABANDONED_STATUSES.map((status) =>
        ctx.db
          .query("emails")
          .withIndex("by_status_retentionAnchor", (q) =>
            q.eq("status", status).lt("retentionAnchor", cutoff),
          )
          .take(CLEANUP_BATCH_SIZE),
      ),
    );
    const oldAndAbandoned = [...waiting, ...queued];

    for (const email of oldAndAbandoned) {
      await cleanupEmail(ctx, email);
    }
    if (oldAndAbandoned.length > 0) {
      console.log(`Cleaned up ${oldAndAbandoned.length} abandoned emails`);
    }
    if (
      waiting.length === CLEANUP_BATCH_SIZE ||
      queued.length === CLEANUP_BATCH_SIZE
    ) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      });
    }
    return null;
  },
});

// One-time migration for deployments upgrading from <= 0.1.1, which persisted
// the raw useSend API key in `emails.options.apiKey`. Removes the legacy field
// from stored rows in batches, rescheduling itself until the table has been
// fully scanned. Safe to run repeatedly.
export const scrubApiKeys = mutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const SCRUB_BATCH_SIZE = 100;
    // A real pagination cursor (not a _creationTime bound) so rows sharing a
    // creation timestamp are never skipped across page boundaries. Built-in
    // .paginate() is not supported inside components, so use the
    // convex-helpers paginator.
    const { page, isDone, continueCursor } = await paginator(ctx.db, schema)
      .query("emails")
      .paginate({ numItems: SCRUB_BATCH_SIZE, cursor: args.cursor ?? null });

    let scrubbed = 0;
    for (const email of page) {
      if (email.options.apiKey !== undefined) {
        const options = { ...email.options };
        delete options.apiKey;
        await ctx.db.patch(email._id, { options });
        scrubbed += 1;
      }
    }
    if (scrubbed > 0) {
      console.log(`Scrubbed legacy API keys from ${scrubbed} emails`);
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(0, api.lib.scrubApiKeys, {
        cursor: continueCursor,
      });
    }
    return null;
  },
});
