import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { api, components, internal } from "./_generated/api.js";
import type{ Id,  Doc } from "./_generated/dataModel.js";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import type { EmailEvent, EmailStatus, UseSendOptions } from "./types.js";
import {
  vOptions,
  isEmailEventType,
} from "./types.js";

// Configuration constants
const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 1000;
const BATCH_SIZE = 100;
const EMAIL_POOL_SIZE = 4;
const CALLBACK_POOL_SIZE = 4;
const USESEND_API_RATE_LIMIT_MS = 600; // Conservative rate limiting
const FINALIZED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;
const ABANDONED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// HTTP status codes that indicate permanent errors
const PERMANENT_ERROR_CODES = new Set([
  400, 401, 403, 404, 405, 406, 407, 408, 410, 411, 413, 414, 415, 416, 418,
  421, 422, 426, 427, 428, 431,
]);

// Calculate segment for batching to avoid contention
function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
}

// Workpool for email sending
const emailPool = new Workpool(components.emailWorkpool, {
  maxParallelism: EMAIL_POOL_SIZE,
});

// Workpool for callbacks
const callbackPool = new Workpool(components.callbackWorkpool, {
  maxParallelism: CALLBACK_POOL_SIZE,
});

// Rate limiter for useSend API
const usesendRateLimiter = new RateLimiter(components.rateLimiter, {
  usesendApi: {
    kind: "fixed window",
    period: USESEND_API_RATE_LIMIT_MS,
    rate: 1,
  },
});

// ============================================
// Queries
// ============================================

/**
 * Get the status of an email.
 */
export const getStatus = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      status: v.union(
        v.literal("waiting"),
        v.literal("queued"),
        v.literal("sent"),
        v.literal("delivery_delayed"),
        v.literal("delivered"),
        v.literal("bounced"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("suppressed"),
      ),
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

/**
 * Get the full email details.
 */
export const get = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      _id: v.id("emails"),
      _creationTime: v.number(),
      from: v.string(),
      to: v.array(v.string()),
      cc: v.optional(v.array(v.string())),
      bcc: v.optional(v.array(v.string())),
      subject: v.optional(v.string()),
      html: v.optional(v.string()),
      text: v.optional(v.string()),
      template: v.optional(
        v.object({
          id: v.string(),
          variables: v.optional(v.record(v.string(), v.any())),
        }),
      ),
      headers: v.optional(
        v.array(
          v.object({
            name: v.string(),
            value: v.string(),
          }),
        ),
      ),
      status: v.union(
        v.literal("waiting"),
        v.literal("queued"),
        v.literal("sent"),
        v.literal("delivery_delayed"),
        v.literal("delivered"),
        v.literal("bounced"),
        v.literal("failed"),
        v.literal("cancelled"),
        v.literal("suppressed"),
      ),
      usesendId: v.optional(v.string()),
      bounced: v.boolean(),
      complained: v.boolean(),
      failed: v.boolean(),
      deliveryDelayed: v.boolean(),
      opened: v.boolean(),
      clicked: v.boolean(),
      errorMessage: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.any())),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }

    // Fetch content if available
    const html = email.html
      ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
      : undefined;
    const text = email.text
      ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
      : undefined;

    return {
      _id: email._id,
      _creationTime: email._creationTime,
      from: email.from,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html,
      text,
      template: email.template,
      headers: email.headers,
      status: email.status,
      usesendId: email.usesendId,
      bounced: email.bounced ?? false,
      complained: email.complained,
      failed: email.failed ?? false,
      deliveryDelayed: email.deliveryDelayed ?? false,
      opened: email.opened,
      clicked: email.clicked ?? false,
      errorMessage: email.errorMessage,
      metadata: email.metadata,
    };
  },
});

/**
 * List emails by status.
 */
export const listByStatus = query({
  args: {
    status: v.union(
      v.literal("waiting"),
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivery_delayed"),
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("suppressed"),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("emails"),
      _creationTime: v.number(),
      from: v.string(),
      to: v.array(v.string()),
      subject: v.optional(v.string()),
      status: v.string(),
      usesendId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) => q.eq("status", args.status))
      .order("desc")
      .take(args.limit ?? 100);

    return emails.map((email) => ({
      _id: email._id,
      _creationTime: email._creationTime,
      from: email.from,
      to: email.to,
      subject: email.subject,
      status: email.status,
      usesendId: email.usesendId,
    }));
  },
});

// ============================================
// Mutations
// ============================================

/**
 * Send an email. Stores it in the queue for batch processing.
 */
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
    template: v.optional(
      v.object({
        id: v.string(),
        variables: v.optional(v.record(v.string(), v.any())),
      }),
    ),
    replyTo: v.optional(v.array(v.string())),
    headers: v.optional(
      v.array(
        v.object({
          name: v.string(),
          value: v.string(),
        }),
      ),
    ),
    metadata: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    // Validate content
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

    // Store content separately
    let htmlContentId: Id<"content"> | undefined;
    if (args.html !== undefined) {
      htmlContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.html).buffer as ArrayBuffer,
        mimeType: "text/html",
      });
    }

    let textContentId: Id<"content"> | undefined;
    if (args.text !== undefined) {
      textContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.text).buffer as ArrayBuffer,
        mimeType: "text/plain",
      });
    }

    // Calculate segment for batching
    const segment = getSegment(Date.now());

    // Insert email
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
      metadata: args.metadata,
    });

    // Schedule batch processing
    await scheduleBatchRun(ctx, args.options);

    return emailId;
  },
});

/**
 * Cancel an email that hasn't been sent yet.
 */
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
    return null;
  },
});

// ============================================
// Internal Functions
// ============================================

/**
 * Schedule the batch runner if not already running.
 */
async function scheduleBatchRun(ctx: MutationCtx, options: UseSendOptions) {
  // Store/update options
  const configDoc = await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", "options"))
    .unique();

  if (!configDoc) {
    await ctx.db.insert("config", {
      key: "options",
      value: options,
    });
  } else {
    await ctx.db.patch(configDoc._id, {
      value: options,
    });
  }

  // Check if batch runner already scheduled
  const existingRun = await ctx.db.query("nextBatchRun").first();
  if (existingRun) {
    return;
  }

  // Schedule batch runner
  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    {
      reloop: false,
      segment: getSegment(Date.now() + BASE_BATCH_DELAY),
    },
  );

  await ctx.db.insert("nextBatchRun", {
    runId,
    scheduledAt: Date.now(),
  });
}

/**
 * Internal mutation to process email batches.
 */
export const makeBatch = internalMutation({
  args: {
    reloop: v.boolean(),
    segment: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get options
    const configDoc = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "options"))
      .unique();

    if (!configDoc) {
      throw new Error("No configuration found");
    }

    const options = configDoc.value as UseSendOptions;

    // Get batch of waiting emails
    const emails = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) =>
        q.eq("status", "waiting").lte("segment", args.segment - 2),
      )
      .take(BATCH_SIZE);

    // If no emails or short batch on reloop, reschedule
    if (emails.length === 0 || (args.reloop && emails.length < BATCH_SIZE)) {
      await rescheduleBatch(ctx, emails.length > 0);
      return null;
    }

    console.log(`Processing batch of ${emails.length} emails`);

    // Mark emails as queued
    for (const email of emails) {
      await ctx.db.patch(email._id, {
        status: "queued",
      });
    }

    // Calculate rate limit delay
    const delay = await getRateLimitDelay(ctx);

    // Enqueue workpool action
    await emailPool.enqueueAction(
      ctx,
      internal.lib.callUseSendAPI,
      {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl ?? "https://app.usesend.com",
        emailIds: emails.map((e) => e._id),
      },
      {
        retry: {
          maxAttempts: options.retryAttempts ?? 3,
          initialBackoffMs: options.initialBackoffMs ?? 1000,
          base: 2,
        },
        runAfter: delay,
        context: { emailIds: emails.map((e) => e._id) },
        onComplete: internal.lib.onEmailComplete,
      },
    );

    // Continue processing
    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
      reloop: true,
      segment: args.segment,
    });

    return null;
  },
});

/**
 * Reschedule batch runner.
 */
async function rescheduleBatch(ctx: MutationCtx, hasEmails: boolean) {
  if (!hasEmails) {
    // No emails, clean up batch run tracker
    const batchRun = await ctx.db.query("nextBatchRun").first();
    if (batchRun) {
      await ctx.db.delete(batchRun._id);
    }
  } else {
    // Schedule next run
    const segment = getSegment(Date.now() + BASE_BATCH_DELAY);
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeBatch, {
      reloop: false,
      segment,
    });
  }
}

/**
 * Get rate limit delay.
 */
async function getRateLimitDelay(ctx: MutationCtx): Promise<number> {
  const limit = await usesendRateLimiter.limit(ctx, "usesendApi", {
    reserve: true,
  });
  const jitter = Math.random() * 100;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
}

/**
 * Call useSend API to send emails.
 */
export const callUseSendAPI = internalAction({
  args: {
    apiKey: v.string(),
    baseUrl: v.string(),
    emailIds: v.array(v.id("emails")),
  },
  returns: v.union(
    v.null(),
    v.object({
      emailIds: v.array(v.id("emails")),
      usesendIds: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    // Fetch email data
    const emails = await ctx.runQuery(internal.lib.getEmailsForSending, {
      emailIds: args.emailIds,
    });

    // Filter out cancelled emails
    const validEmails = emails.filter((e) => e.status === "queued");
    if (validEmails.length === 0) {
      console.log("No valid emails to send (all cancelled or failed)");
      return null;
    }

    // Send emails individually (useSend doesn't support batch API)
    const results: { emailId: Id<"emails">; usesendId: string }[] = [];

    for (const email of validEmails) {
      try {
        const payload = buildEmailPayload(email);
        const response = await fetch(`${args.baseUrl}/api/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          if (PERMANENT_ERROR_CODES.has(response.status)) {
            const errorText = await response.text();
            await ctx.runMutation(internal.lib.markEmailFailed, {
              emailId: email._id,
              errorMessage: `useSend API error: ${response.status} ${errorText}`,
            });
            continue;
          }
          throw new Error(`useSend API error: ${response.status}`);
        }

        const data = await response.json();
        results.push({
          emailId: email._id,
          usesendId: data.id,
        });
      } catch (error) {
        console.error(`Failed to send email ${email._id}:`, error);
        throw error; // Will be retried by workpool
      }
    }

    return {
      emailIds: results.map((r) => r.emailId),
      usesendIds: results.map((r) => r.usesendId),
    };
  },
});

/**
 * Build email payload for useSend API.
 */
function buildEmailPayload(email: any): any {
  const payload: any = {
    from: email.from,
    to: email.to,
    subject: email.subject,
  };

  if (email.cc) payload.cc = email.cc;
  if (email.bcc) payload.bcc = email.bcc;
  if (email.replyTo?.length) payload.replyTo = email.replyTo;

  // Add content
  if (email.template) {
    payload.template = email.template;
  } else {
    payload.html = email.html;
    payload.text = email.text;
  }

  // Add headers
  if (email.headers?.length) {
    payload.headers = email.headers.reduce((acc: any, h: any) => {
      acc[h.name] = h.value;
      return acc;
    }, {});
  }

  return payload;
}

/**
 * Get emails with content for sending.
 */
export const getEmailsForSending = internalQuery({
  args: {
    emailIds: v.array(v.id("emails")),
  },
  returns: v.array(
    v.object({
      _id: v.id("emails"),
      status: v.string(),
      from: v.string(),
      to: v.array(v.string()),
      cc: v.optional(v.array(v.string())),
      bcc: v.optional(v.array(v.string())),
      subject: v.optional(v.string()),
      html: v.optional(v.string()),
      text: v.optional(v.string()),
      template: v.optional(
        v.object({
          id: v.string(),
          variables: v.optional(v.record(v.string(), v.any())),
        }),
      ),
      replyTo: v.optional(v.array(v.string())),
      headers: v.optional(
        v.array(
          v.object({
            name: v.string(),
            value: v.string(),
          }),
        ),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const results = [];

    for (const emailId of args.emailIds) {
      const email = await ctx.db.get(emailId);
      if (!email) continue;

      // Fetch content
      const html = email.html
        ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
        : undefined;
      const text = email.text
        ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
        : undefined;

      results.push({
        _id: email._id,
        status: email.status,
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        subject: email.subject,
        html,
        text,
        template: email.template,
        replyTo: email.replyTo,
        headers: email.headers,
      });
    }

    return results;
  },
});

/**
 * Mark an email as failed.
 */
export const markEmailFailed = internalMutation({
  args: {
    emailId: v.id("emails"),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.status !== "queued") {
      return null;
    }
    await ctx.db.patch(args.emailId, {
      status: "failed",
      errorMessage: args.errorMessage,
      failed: true,
      finalizedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Workpool completion handler.
 */
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

      if (!result) return;

      // Update emails with useSend IDs
      for (let i = 0; i < result.emailIds.length; i++) {
        await ctx.db.patch(result.emailIds[i], {
          status: "sent",
          usesendId: result.usesendIds[i],
        });
      }
    } else if (args.result.kind === "failed") {
      // Mark all emails as failed
      for (const emailId of args.context.emailIds) {
        const email = await ctx.db.get(emailId);
        if (!email || email.status !== "queued") continue;

        await ctx.db.patch(emailId, {
          status: "failed",
          errorMessage: args.result.error,
          failed: true,
          finalizedAt: Date.now(),
        });
      }
    } else if (args.result.kind === "canceled") {
      // Mark as cancelled
      for (const emailId of args.context.emailIds) {
        const email = await ctx.db.get(emailId);
        if (!email || email.status !== "queued") continue;

        await ctx.db.patch(emailId, {
          status: "cancelled",
          finalizedAt: Date.now(),
        });
      }
    }
  },
});

// ============================================
// Webhook Event Processing
// ============================================

/**
 * Process a webhook event from useSend.
 */
export const processWebhookEvent = internalMutation({
  args: {
    event: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = args.event as EmailEvent;

    // Validate event type
    if (!isEmailEventType(event.type)) {
      console.warn(`Unknown event type: ${event.type}`);
      return null;
    }

    // Check for duplicate event
    const existingEvent = await ctx.db
      .query("webhookEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
      .first();

    if (existingEvent) {
      console.log(`Duplicate event ignored: ${event.id}`);
      return null;
    }

    // Get email ID from useSend email ID
    const usesendEmailId = event.data.id;
    const email = usesendEmailId
      ? await ctx.db
          .query("emails")
          .withIndex("by_usesendId", (q) => q.eq("usesendId", usesendEmailId))
          .first()
      : null;

    // Store webhook event
    await ctx.db.insert("webhookEvents", {
      eventId: event.id,
      type: event.type,
      emailId: email?._id,
      usesendEmailId,
      data: event,
      createdAt: Date.now(),
      processed: false,
    });

    // Update email status if we found the email
    if (email) {
      await updateEmailFromEvent(ctx, email, event);
    }

    return null;
  },
});

/**
 * Update email record based on webhook event.
 */
async function updateEmailFromEvent(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent,
) {
  // Define status precedence
  const statusRank: Record<EmailStatus, number> = {
    waiting: 0,
    queued: 1,
    sent: 2,
    delivery_delayed: 3,
    delivered: 4,
    bounced: 5,
    failed: 5,
    cancelled: 100,
    suppressed: 5,
  };

  const currentRank = statusRank[email.status];
  const canUpgradeTo = (next: EmailStatus) => {
    if (email.status === "cancelled") return false;
    return statusRank[next] > currentRank;
  };

  switch (event.type) {
    case "email.sent":
      // Already marked as sent when API call succeeded
      break;

    case "email.delivered":
      if (canUpgradeTo("delivered")) {
        await ctx.db.patch(email._id, {
          status: "delivered",
          finalizedAt: Date.now(),
        });
      }
      break;

    case "email.bounced":
      if (canUpgradeTo("bounced") || !email.bounced) {
        await ctx.db.patch(email._id, {
          status: "bounced",
          bounced: true,
          errorMessage: event.data.bounce?.message,
          finalizedAt: Date.now(),
        });
      }
      break;

    case "email.failed":
      if (canUpgradeTo("failed") || !email.failed) {
        await ctx.db.patch(email._id, {
          status: "failed",
          failed: true,
          errorMessage: event.data.failed?.reason,
          finalizedAt: Date.now(),
        });
      }
      break;

    case "email.delivery_delayed":
      if (canUpgradeTo("delivery_delayed") || !email.deliveryDelayed) {
        await ctx.db.patch(email._id, {
          status: "delivery_delayed",
          deliveryDelayed: true,
        });
      }
      break;

    case "email.complained":
      if (!email.complained) {
        await ctx.db.patch(email._id, {
          complained: true,
          finalizedAt:
            email.finalizedAt === FINALIZED_EPOCH
              ? Date.now()
              : email.finalizedAt,
        });
      }
      break;

    case "email.opened":
      if (!email.opened) {
        await ctx.db.patch(email._id, {
          opened: true,
        });
      }
      break;

    case "email.clicked":
      if (!email.clicked) {
        await ctx.db.patch(email._id, {
          clicked: true,
        });
      }
      break;

    case "email.suppressed":
      if (canUpgradeTo("suppressed")) {
        await ctx.db.patch(email._id, {
          status: "suppressed",
          finalizedAt: Date.now(),
        });
      }
      break;

    case "email.cancelled":
      if (canUpgradeTo("cancelled")) {
        await ctx.db.patch(email._id, {
          status: "cancelled",
          finalizedAt: Date.now(),
        });
      }
      break;
  }

  // Mark webhook event as processed
  const webhookEvent = await ctx.db
    .query("webhookEvents")
    .withIndex("by_eventId", (q) => q.eq("eventId", event.id))
    .first();

  if (webhookEvent) {
    await ctx.db.patch(webhookEvent._id, {
      processed: true,
    });
  }
}

// ============================================
// Cleanup Functions
// ============================================

/**
 * Clean up old finalized emails.
 */
export const cleanupOldEmails = mutation({
  args: {
    olderThan: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const batchSize = 100;

    const oldEmails = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan),
      )
      .take(batchSize);

    for (const email of oldEmails) {
      await cleanupEmail(ctx, email);
    }

    if (oldEmails.length > 0) {
      console.log(`Cleaned up ${oldEmails.length} old emails`);
    }

    if (oldEmails.length === batchSize) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEmails, {
        olderThan,
      });
    }

    return null;
  },
});

/**
 * Clean up abandoned emails (non-finalized but old).
 */
export const cleanupAbandonedEmails = mutation({
  args: {
    olderThan: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const batchSize = 500;

    const cutoffTime = Date.now() - olderThan;
    const oldEmails = await ctx.db
      .query("emails")
      .order("desc")
      .take(batchSize)
      .then((emails) => emails.filter((e) => e._creationTime < cutoffTime));

    for (const email of oldEmails) {
      await cleanupEmail(ctx, email);
    }

    if (oldEmails.length > 0) {
      console.log(`Cleaned up ${oldEmails.length} abandoned emails`);
    }

    if (oldEmails.length === batchSize) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      });
    }

    return null;
  },
});

/**
 * Clean up old webhook events.
 */
export const cleanupOldEvents = mutation({
  args: {
    olderThan: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const batchSize = 500;

    const oldEvents = await ctx.db
      .query("webhookEvents")
      .withIndex("by_processed", (q) =>
        q.eq("processed", true).lt("_creationTime", Date.now() - olderThan),
      )
      .take(batchSize);

    for (const event of oldEvents) {
      await ctx.db.delete(event._id);
    }

    if (oldEvents.length > 0) {
      console.log(`Cleaned up ${oldEvents.length} old webhook events`);
    }

    if (oldEvents.length === batchSize) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEvents, {
        olderThan,
      });
    }

    return null;
  },
});

/**
 * Helper to clean up a single email and its content.
 */
async function cleanupEmail(ctx: MutationCtx, email: Doc<"emails">) {
  await ctx.db.delete(email._id);

  if (email.text) {
    await ctx.db.delete(email.text);
  }
  if (email.html) {
    await ctx.db.delete(email.html);
  }

  // Clean up associated webhook events
  const events = await ctx.db
    .query("webhookEvents")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .collect();

  for (const event of events) {
    await ctx.db.delete(event._id);
  }
}
