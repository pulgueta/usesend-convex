import { literals } from "convex-helpers/validators";
import {
  type GenericActionCtx,
  type GenericDataModel,
  type GenericQueryCtx,
} from "convex/server";
import { type Infer, v } from "convex/values";

// Validator for the onEmailEvent option.
export const onEmailEvent = v.object({
  fnHandle: v.string(),
});

// Validator for the status of an email.
export const vStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("delivery_delayed"),
  v.literal("bounced"),
  v.literal("failed"),
);
export type Status = Infer<typeof vStatus>;

// Validator for template data.
export const vTemplate = v.object({
  id: v.string(),
  variables: v.optional(v.record(v.string(), v.union(v.string(), v.number()))),
});
export type Template = Infer<typeof vTemplate>;

// Validator for the runtime options used by the component.
export const vOptions = v.object({
  initialBackoffMs: v.number(),
  retryAttempts: v.number(),
  requestTimeoutMs: v.number(),
  apiKey: v.string(),
  baseUrl: v.string(),
  onEmailEvent: v.optional(onEmailEvent),
});

export type RuntimeConfig = Infer<typeof vOptions>;

const commonFields = {
  id: v.string(),
  status: v.string(),
  from: v.string(),
  to: v.array(v.string()),
  subject: v.optional(v.string()),
  occurredAt: v.string(),
  campaignId: v.optional(v.string()),
  contactId: v.optional(v.string()),
  domainId: v.optional(v.number()),
  templateId: v.optional(v.string()),
  metadata: v.optional(v.any()),
};

// Normalized webhook events coming from useSend.
export const vEmailEvent = v.union(
  v.object({
    type: v.literal("email.queued"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.sent"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.delivered"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.delivery_delayed"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.complained"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.bounced"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object({
      ...commonFields,
      bounce: v.object({
        type: v.string(),
        subType: v.string(),
        message: v.optional(v.string()),
      }),
    }),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.opened"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object({
      ...commonFields,
      open: v.object({
        timestamp: v.string(),
        userAgent: v.optional(v.string()),
        ip: v.optional(v.string()),
        platform: v.optional(v.string()),
      }),
    }),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.clicked"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object({
      ...commonFields,
      click: v.object({
        timestamp: v.string(),
        url: v.string(),
        userAgent: v.optional(v.string()),
        ip: v.optional(v.string()),
        platform: v.optional(v.string()),
      }),
    }),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.failed"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object({
      ...commonFields,
      failed: v.object({
        reason: v.string(),
      }),
    }),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.rendering_failure"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.rejected"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.cancelled"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object(commonFields),
    attempt: v.number(),
  }),
  v.object({
    type: v.literal("email.suppressed"),
    id: v.string(),
    version: v.string(),
    createdAt: v.string(),
    teamId: v.number(),
    data: v.object({
      ...commonFields,
      suppression: v.object({
        type: v.string(),
        reason: v.string(),
        source: v.optional(v.string()),
      }),
    }),
    attempt: v.number(),
  }),
);

export const ACCEPTED_EVENT_TYPES = [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.delivery_delayed",
  "email.opened",
  "email.clicked",
  "email.rejected",
  "email.rendering_failure",
  "email.cancelled",
  "email.suppressed",
] as const;

export const vEventType = v.union(literals(...ACCEPTED_EVENT_TYPES));

export type EmailEvent = Infer<typeof vEmailEvent>;
export type EventEventTypes = EmailEvent["type"];
export type EventEventOfType<T extends EventEventTypes> = Extract<
  EmailEvent,
  { type: T }
>;

/* Type utils follow */

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
};
