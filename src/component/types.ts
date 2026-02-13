import { v } from "convex/values";

/**
 * Type definitions and validators for useSend webhook events.
 *
 * Based on useSend documentation: https://docs.usesend.com/webhooks
 */

// Email event types
export const EMAIL_EVENT_TYPES = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.rejected",
  "email.complained",
  "email.failed",
  "email.cancelled",
  "email.suppressed",
  "email.opened",
  "email.clicked",
] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

// Validator for email event types
export const vEmailEventType = v.union(
  v.literal("email.queued"),
  v.literal("email.sent"),
  v.literal("email.delivered"),
  v.literal("email.delivery_delayed"),
  v.literal("email.bounced"),
  v.literal("email.rejected"),
  v.literal("email.complained"),
  v.literal("email.failed"),
  v.literal("email.cancelled"),
  v.literal("email.suppressed"),
  v.literal("email.opened"),
  v.literal("email.clicked"),
);

// Base email data shared across all email events
export const vEmailBaseData = v.object({
  id: v.string(), // Email ID
  status: v.string(), // Email status
  from: v.string(), // Sender email address
  to: v.array(v.string()), // Recipient email addresses
  occurredAt: v.string(), // ISO 8601 timestamp
  subject: v.optional(v.string()),
  campaignId: v.optional(v.string()),
  contactId: v.optional(v.string()),
  domainId: v.optional(v.number()),
  templateId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

// Bounce details
export const vBounceData = v.object({
  type: v.union(
    v.literal("Transient"),
    v.literal("Permanent"),
    v.literal("Undetermined"),
  ),
  subType: v.union(
    v.literal("General"),
    v.literal("NoEmail"),
    v.literal("Suppressed"),
    v.literal("OnAccountSuppressionList"),
    v.literal("MailboxFull"),
    v.literal("MessageTooLarge"),
    v.literal("ContentRejected"),
    v.literal("AttachmentRejected"),
  ),
  message: v.optional(v.string()),
});

// Failed details
export const vFailedData = v.object({
  reason: v.string(),
});

// Suppression details
export const vSuppressionData = v.object({
  type: v.union(
    v.literal("Bounce"),
    v.literal("Complaint"),
    v.literal("Manual"),
  ),
  reason: v.string(),
  source: v.optional(v.string()),
});

// Open tracking details
export const vOpenData = v.object({
  timestamp: v.string(),
  userAgent: v.optional(v.string()),
  ip: v.optional(v.string()),
  platform: v.optional(v.string()),
});

// Click tracking details
export const vClickData = v.object({
  timestamp: v.string(),
  url: v.string(),
  userAgent: v.optional(v.string()),
  ip: v.optional(v.string()),
  platform: v.optional(v.string()),
});

// Complete email event validator
export const vEmailEvent = v.object({
  id: v.string(), // Event ID (unique for deduplication)
  type: vEmailEventType, // Event type
  version: v.string(), // API version
  createdAt: v.string(), // ISO 8601 timestamp
  teamId: v.number(), // Team ID
  data: vEmailBaseData, // Event-specific data
  attempt: v.number(), // Delivery attempt number
});

export type EmailEvent = {
  id: string;
  type: EmailEventType;
  version: string;
  createdAt: string;
  teamId: number;
  data: {
    id: string;
    status: string;
    from: string;
    to: string[];
    occurredAt: string;
    subject?: string;
    campaignId?: string;
    contactId?: string;
    domainId?: number;
    templateId?: string;
    metadata?: Record<string, any>;
    bounce?: {
      type: "Transient" | "Permanent" | "Undetermined";
      subType: string;
      message?: string;
    };
    failed?: {
      reason: string;
    };
    suppression?: {
      type: "Bounce" | "Complaint" | "Manual";
      reason: string;
      source?: string;
    };
    open?: {
      timestamp: string;
      userAgent?: string;
      ip?: string;
      platform?: string;
    };
    click?: {
      timestamp: string;
      url: string;
      userAgent?: string;
      ip?: string;
      platform?: string;
    };
  };
  attempt: number;
};

// Webhook payload validator
export const vWebhookPayload = v.object({
  id: v.string(),
  type: v.string(),
  version: v.string(),
  createdAt: v.string(),
  teamId: v.number(),
  data: v.any(),
  attempt: v.number(),
});

// Component options
export const vOptions = v.object({
  apiKey: v.string(),
  webhookSecret: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  retryAttempts: v.optional(v.number()),
  initialBackoffMs: v.optional(v.number()),
});

export type UseSendOptions = {
  apiKey: string;
  webhookSecret?: string;
  baseUrl?: string;
  retryAttempts?: number;
  initialBackoffMs?: number;
};

// Email status for queries
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

export type EmailStatus =
  | "waiting"
  | "queued"
  | "sent"
  | "delivery_delayed"
  | "delivered"
  | "bounced"
  | "failed"
  | "cancelled"
  | "suppressed";

// Email ID branded type
export type EmailId = string & { __brand: "EmailId" };

// Status response
export type EmailStatusResponse = {
  status: EmailStatus;
  errorMessage: string | null;
  bounced: boolean;
  complained: boolean;
  failed: boolean;
  deliveryDelayed: boolean;
  opened: boolean;
  clicked: boolean;
};

// Send email arguments
export interface SendEmailArgs {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  template?: {
    id: string;
    variables?: Record<string, any>;
  };
  replyTo?: string | string[];
  headers?: Record<string, string>;
  metadata?: Record<string, any>;
}

// Utility function to validate email event type
export function isEmailEventType(type: string): type is EmailEventType {
  return EMAIL_EVENT_TYPES.includes(type as EmailEventType);
}

// Extract useSend email ID from webhook event data
export function getEmailIdFromEvent(event: EmailEvent): string | undefined {
  return event.data?.id;
}
