import { v } from "convex/values";
import {
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
  ACCEPTED_EVENT_TYPES,
  type RuntimeConfig,
  vEmailEvent,
  vOptions,
  vStatus,
  vTemplate,
} from "./shared.js";
import type { FunctionHandle } from "convex/server";
import type { EmailEvent, RunMutationCtx, RunQueryCtx } from "./shared.js";
import { attemptToParse } from "./utils.js";

// Configuration constants
const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 1000;
const BATCH_SIZE = 100;
const EMAIL_POOL_SIZE = 4;
const CALLBACK_POOL_SIZE = 4;
const USESEND_ONE_CALL_EVERY_MS = 600;
const FINALIZED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;
const ABANDONED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const PERMANENT_ERROR_CODES = new Set([
  400, 401, 403, 404, 405, 406, 407, 408, 410, 411, 413, 414, 415, 416, 418,
  421, 422, 426, 427, 428, 431,
]);

function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
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

    const segment = getSegment(Date.now());

    const emailId = await ctx.db.insert("emails", {
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
      finalizedAt: FINALIZED_EPOCH,
    });

    await scheduleBatchRun(ctx, args.options);
    return emailId;
  },
});

// Create a manual email entry (for direct API calls)
export const createManualEmail = mutation({
  args: {
    from: v.string(),
    to: v.union(v.array(v.string()), v.string()),
    subject: v.string(),
    replyTo: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    const emailId = await ctx.db.insert("emails", {
      from: args.from,
      to: Array.isArray(args.to) ? args.to : [args.to],
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
    if (email.status !== "waiting" && email.status !== "queued") {
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
async function scheduleBatchRun(ctx: MutationCtx, options: RuntimeConfig) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", { options });
  } else {
    const hasChanged =
      JSON.stringify(lastOptions.options) !== JSON.stringify(options);
    if (hasChanged) {
      await ctx.db.replace(lastOptions._id, { options });
    }
  }

  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    return;
  }

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    { reloop: false, segment: getSegment(Date.now() + BASE_BATCH_DELAY) },
  );

  await ctx.db.insert("nextBatchRun", { runId });
}

// Process email batches
export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lastOptions = await ctx.db.query("lastOptions").unique();
    if (!lastOptions) {
      throw new Error("No last options found -- invariant");
    }
    const options = lastOptions.options;

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

    for (const email of emails) {
      await ctx.db.patch(email._id, { status: "queued" });
    }

    const delay = await getDelay(ctx);

    await emailPool.enqueueAction(
      ctx,
      internal.lib.callUseSendAPIWithBatch,
      {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        emails: emails.map((e) => e._id),
      },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        runAfter: delay,
        context: { emailIds: emails.map((e) => e._id) },
        onComplete: internal.lib.onEmailComplete,
      },
    );

    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
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
    if (!batchRun) {
      throw new Error("No batch run found -- invariant");
    }
    await ctx.db.delete(batchRun._id);
  } else {
    const segment = getSegment(Date.now() + BASE_BATCH_DELAY);
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeBatch, {
      reloop: false,
      segment,
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

const vBatchReturns = v.union(
  v.null(),
  v.object({
    emailIds: v.array(v.id("emails")),
    usesendIds: v.array(v.string()),
  }),
);

// Call useSend batch API
export const callUseSendAPIWithBatch = internalAction({
  args: {
    apiKey: v.string(),
    baseUrl: v.string(),
    emails: v.array(v.id("emails")),
  },
  returns: vBatchReturns,
  handler: async (ctx, args) => {
    const batchPayload = await createUseSendBatchPayload(ctx, args.emails);

    if (batchPayload === null) {
      console.log("No emails to send in batch. All were cancelled or failed.");
      return null;
    }

    const [emailIds, body] = batchPayload;

    const response = await fetch(`${args.baseUrl}/api/v1/emails/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.emails[0].toString(),
      },
      body,
    });

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
    } else {
      const data = await response.json();
      if (!data.data) {
        throw new Error("useSend API error: No data returned");
      }
      return {
        emailIds,
        usesendIds: data.data.map((d: { emailId: string }) => d.emailId),
      };
    }
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
      const result = args.result.returnValue as {
        emailIds: Id<"emails">[];
        usesendIds: string[];
      } | null;
      if (result === null) {
        return;
      }
      const { emailIds, usesendIds } = result;
      await Promise.all(
        emailIds.map((emailId, i) =>
          ctx.db.patch(emailId, {
            status: "sent",
            usesendId: usesendIds[i],
          }),
        ),
      );
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
): Promise<[Id<"emails">[], string] | null> {
  const allEmails = await ctx.runQuery(internal.lib.getEmailsByIds, {
    emailIds,
  });
  const emails = allEmails.filter((e) => e.status === "queued");
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
      payload.variables = email.template.variables;
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

// Compute email updates from webhook events
function computeEmailUpdateFromEvent(
  email: Doc<"emails">,
  event: EmailEvent,
): Doc<"emails"> | null {
  const statusRank: Record<Doc<"emails">["status"], number> = {
    waiting: 0,
    queued: 1,
    sent: 2,
    delivery_delayed: 3,
    delivered: 4,
    bounced: 5,
    failed: 5,
    cancelled: 100,
  };

  const currentRank = statusRank[email.status];
  const canUpgradeTo = (next: Doc<"emails">["status"]) => {
    if (email.status === "cancelled") return false;
    return statusRank[next] > currentRank;
  };

  if (event.type === "email.sent" || event.type === "email.queued") return null;

  if (event.type === "email.clicked") {
    if (email.clicked) return null;
    return { ...email, clicked: true };
  }

  if (event.type === "email.failed") {
    const statusWillChange = canUpgradeTo("failed");
    if (!statusWillChange && email.failed) return null;
    const updated: Doc<"emails"> = { ...email, failed: true };
    if (statusWillChange) {
      updated.status = "failed";
      updated.finalizedAt = Date.now();
    }
    if ("failed" in event.data && event.data.failed) {
      updated.errorMessage = event.data.failed.reason;
    }
    return updated;
  }

  if (event.type === "email.delivered") {
    if (!canUpgradeTo("delivered")) return null;
    return { ...email, status: "delivered", finalizedAt: Date.now() };
  }

  if (event.type === "email.bounced") {
    const statusWillChange = canUpgradeTo("bounced");
    if (!statusWillChange && email.bounced) return null;
    const updated: Doc<"emails"> = {
      ...email,
      bounced: true,
    };
    if ("bounce" in event.data && event.data.bounce) {
      updated.errorMessage = event.data.bounce.message;
    }
    if (statusWillChange) {
      updated.status = "bounced";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.type === "email.delivery_delayed") {
    const statusWillChange = canUpgradeTo("delivery_delayed");
    if (!statusWillChange && email.deliveryDelayed) return null;
    const updated: Doc<"emails"> = { ...email, deliveryDelayed: true };
    if (statusWillChange) {
      updated.status = "delivery_delayed";
    }
    return updated;
  }

  if (event.type === "email.complained") {
    if (email.complained) return null;
    return {
      ...email,
      complained: true,
      finalizedAt:
        email.finalizedAt === FINALIZED_EPOCH ? Date.now() : email.finalizedAt,
    };
  }

  if (event.type === "email.opened") {
    if (email.opened) return null;
    return { ...email, opened: true };
  }

  if (
    event.type === "email.rejected" ||
    event.type === "email.rendering_failure" ||
    event.type === "email.cancelled" ||
    event.type === "email.suppressed"
  ) {
    const statusWillChange = canUpgradeTo("failed");
    if (!statusWillChange && email.failed) return null;
    const updated: Doc<"emails"> = { ...email, failed: true };
    if (statusWillChange) {
      updated.status = "failed";
      updated.finalizedAt = Date.now();
    }
    if (event.type === "email.suppressed" && "suppression" in event.data) {
      updated.errorMessage = `Suppressed: ${event.data.suppression.reason}`;
    }
    return updated;
  }

  return null;
}

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
    const emailId = event.data.id;

    const email = await ctx.db
      .query("emails")
      .withIndex("by_usesendId", (q) => q.eq("usesendId", emailId))
      .unique();

    if (!email) {
      console.info(`Email not found for usesendId: ${emailId}, ignoring...`);
      return;
    }

    if (
      ACCEPTED_EVENT_TYPES.includes(
        event.type as (typeof ACCEPTED_EVENT_TYPES)[number],
      )
    ) {
      await ctx.db.insert("deliveryEvents", {
        emailId: email._id,
        usesendId: emailId,
        eventType: event.type as (typeof ACCEPTED_EVENT_TYPES)[number],
        createdAt: event.createdAt,
        message:
          event.type === "email.bounced" && "bounce" in event.data
            ? event.data.bounce?.message
            : event.type === "email.failed" && "failed" in event.data
              ? event.data.failed?.reason
              : undefined,
      });
    }

    const updated = computeEmailUpdateFromEvent(email, event);
    if (updated) {
      await ctx.db.replace(email._id, updated);
    }

    await enqueueCallbackIfExists(ctx, email, event);
  },
});

async function enqueueCallbackIfExists(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent,
) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    return;
  }
  if (lastOptions.options.onEmailEvent) {
    const handle = lastOptions.options.onEmailEvent.fnHandle as FunctionHandle<
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
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const oldAndAbandoned = await ctx.db
      .query("emails")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - olderThan),
      )
      .take(500);

    for (const email of oldAndAbandoned) {
      await cleanupEmail(ctx, email);
    }
    if (oldAndAbandoned.length > 0) {
      console.log(`Cleaned up ${oldAndAbandoned.length} abandoned emails`);
    }
    if (oldAndAbandoned.length === 500) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      });
    }
  },
});
