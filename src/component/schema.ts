import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema for the useSend Convex component.
 *
 * This component provides email sending capabilities with webhook handling,
 * batching, rate limiting, and status tracking.
 */

export const vEmailStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivery_delayed"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("suppressed"),
);

export default defineSchema({
  /**
   * Stores email content (HTML/text) separately to reduce memory usage
   * when working with batches of emails.
   */
  content: defineTable({
    content: v.bytes(),
    mimeType: v.string(),
  }),

  /**
   * Main emails table with status tracking.
   */
  emails: defineTable({
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
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
    // Status tracking
    status: vEmailStatus,
    // Segment for batching to avoid contention
    segment: v.number(),
    // useSend's email ID (returned from API)
    usesendId: v.optional(v.string()),
    // Event tracking flags
    bounced: v.boolean(),
    complained: v.boolean(),
    failed: v.boolean(),
    deliveryDelayed: v.boolean(),
    opened: v.boolean(),
    clicked: v.boolean(),
    // Error information
    errorMessage: v.optional(v.string()),
    // For cleanup - when the email reached a terminal state
    finalizedAt: v.number(),
    // Custom metadata attached by the user
    metadata: v.optional(v.record(v.string(), v.any())),
    // Reply-to addresses
    replyTo: v.optional(v.array(v.string())),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_usesendId", ["usesendId"])
    .index("by_finalizedAt", ["finalizedAt"]),

  /**
   * Stores all incoming webhook events from useSend.
   */
  webhookEvents: defineTable({
    // useSend's event ID for deduplication
    eventId: v.string(),
    // Event type: email.delivered, email.bounced, etc.
    type: v.string(),
    // Reference to our email record (if applicable)
    emailId: v.optional(v.id("emails")),
    // useSend's email ID
    usesendEmailId: v.optional(v.string()),
    // Full event payload
    data: v.any(),
    // When the event was received
    createdAt: v.number(),
    // Whether this event has been processed
    processed: v.boolean(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_emailId", ["emailId"])
    .index("by_type", ["type"])
    .index("by_processed", ["processed"]),

  /**
   * Component configuration and runtime state.
   */
  config: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  /**
   * Tracks the scheduled batch runner to ensure only one runs at a time.
   */
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
    scheduledAt: v.number(),
  }),
});
