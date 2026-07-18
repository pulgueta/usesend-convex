import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vEmailEvent,
  vEventType,
  vStatus,
  vStoredOptions,
  vTemplate,
} from "./shared.js";

export default defineSchema({
  content: defineTable({
    content: v.bytes(),
    mimeType: v.string(),
    filename: v.optional(v.string()),
    path: v.optional(v.string()),
  }),
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  deliveryEvents: defineTable({
    eventId: v.string(),
    emailId: v.id("emails"),
    usesendId: v.string(),
    eventType: vEventType,
    createdAt: v.string(),
    message: v.optional(v.string()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_emailId_eventType", ["emailId", "eventType"]),
  pendingEvents: defineTable({
    eventId: v.string(),
    usesendId: v.string(),
    event: vEmailEvent,
    attempts: v.number(),
  }).index("by_eventId", ["eventId"]),
  migrationLeases: defineTable({
    name: v.string(),
    expiresAt: v.number(),
  }).index("by_name", ["name"]),
  emails: defineTable({
    // New writes never contain the raw API key. Legacy rows may retain it
    // temporarily until `scrubApiKeys` can safely remove it.
    options: vStoredOptions,
    from: v.string(),
    to: v.union(v.array(v.string()), v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    replyTo: v.array(v.string()),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
    template: v.optional(vTemplate),
    headers: v.optional(v.record(v.string(), v.string())),
    scheduledAt: v.optional(v.string()),
    inReplyToId: v.optional(v.string()),
    status: vStatus,
    complained: v.boolean(),
    errorMessage: v.optional(v.string()),
    opened: v.boolean(),
    bounced: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
    deliveryDelayed: v.optional(v.boolean()),
    clicked: v.optional(v.boolean()),
    usesendId: v.optional(v.string()),
    segment: v.number(),
    retentionAnchor: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_status_retentionAnchor", ["status", "retentionAnchor"])
    .index("by_usesendId", ["usesendId"])
    .index("by_finalizedAt", ["finalizedAt"]),
});
