import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import {
  type EmailId,
  UseSend,
  vOnEmailEventArgs,
  vStatus,
} from "@pulgueta/usesend-convex";
import { v } from "convex/values";

type AuthorizedCtx = Pick<ActionCtx | MutationCtx | QueryCtx, "auth">;

async function requireExampleAdmin(ctx: AuthorizedCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const adminTokenIdentifier =
    process.env.USESEND_EXAMPLE_ADMIN_TOKEN_IDENTIFIER;
  if (
    !identity ||
    !adminTokenIdentifier ||
    identity.tokenIdentifier !== adminTokenIdentifier
  ) {
    throw new Error("Administrator access required");
  }
}

// Handle email events from webhook
// NOTE: This must be defined BEFORE the usesend instance to avoid circular reference issues
export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log(`Email ${args.id} received event:`, args.event.type);

    // Handle different event types
    switch (args.event.type) {
      case "email.delivered":
        console.log("Email was delivered successfully!");
        break;
      case "email.bounced":
        console.log("Email bounced", { eventId: args.event.id });
        break;
      case "email.complained":
        console.log("Email marked as spam");
        break;
      case "email.opened":
        console.log("Email was opened");
        break;
      case "email.clicked":
        console.log("Link in email was clicked");
        break;
      case "email.failed":
        console.log("Email failed to send");
        break;
    }

    // You can update your own tables here based on the event
    // For example, update a user's email status, log analytics, etc.
  },
});

// Initialize the useSend component
// Environment variables aren't available in the component,
// so we need to configure it here with environment variable access.
export const usesend: UseSend = new UseSend(components.usesend, {
  // Optionally override settings:
  // apiKey: process.env.USESEND_API_KEY,
  // baseUrl: process.env.USESEND_BASE_URL, // For self-hosted instances
  // webhookSecret: process.env.USESEND_WEBHOOK_SECRET,
  onEmailEvent: internal.example.handleEmailEvent,
});

// Send a test email
export const sendTestEmail = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireExampleAdmin(ctx);
    const emailId = await usesend.sendEmail(ctx, {
      from: "Test <test@yourdomain.com>",
      to: "recipient@example.com",
      subject: "Hello from useSend Convex Component!",
      html: "<h1>Welcome!</h1><p>This email was sent using the useSend Convex component.</p>",
      text: "Welcome! This email was sent using the useSend Convex component.",
    });

    return emailId;
  },
});

// Send an email with template
export const sendTemplatedEmail = mutation({
  args: {
    to: v.string(),
    name: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireExampleAdmin(ctx);
    const emailId = await usesend.sendEmail(ctx, {
      from: "Notifications <notifications@yourdomain.com>",
      to: args.to,
      template: {
        id: "your-template-id",
        variables: {
          name: args.name,
        },
      },
    });

    return emailId;
  },
});

// Get the status of an email
export const getEmailStatus = query({
  args: { emailId: v.string() },
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
    await requireExampleAdmin(ctx);
    return await usesend.status(ctx, args.emailId as EmailId);
  },
});

// Cancel a pending email
export const cancelEmail = mutation({
  args: { emailId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireExampleAdmin(ctx);
    await usesend.cancelEmail(ctx, args.emailId as EmailId);
  },
});

// The full useSend REST API (contacts, domains, campaigns, analytics, ...)
// is available via `usesend.api` inside actions.
export const listDomains = action({
  args: {},
  returns: v.array(
    v.object({
      id: v.number(),
      name: v.string(),
      status: v.string(),
    }),
  ),
  handler: async (ctx) => {
    await requireExampleAdmin(ctx);
    const domains = await usesend.api.domains.list();
    return domains.map((d) => ({ id: d.id, name: d.name, status: d.status }));
  },
});

export const subscribeContact = action({
  args: {
    contactBookId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireExampleAdmin(ctx);
    const { contactId } = await usesend.api.contacts.create(
      args.contactBookId,
      {
        email: args.email,
        firstName: args.firstName,
        subscribed: true,
      },
    );
    return contactId;
  },
});
