import { mutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import {
  UseSend,
  vOnEmailEventArgs,
} from "@pulgueta/usesend-convex";
import { v } from "convex/values";
import { Auth } from "convex/server";

// Environment variables for useSend configuration
// API key and webhook secret are read from USESEND_API_KEY and USESEND_WEBHOOK_SECRET by default

// Initialize the useSend component
export const usesend = new UseSend(components.usesend, {
  // Optional: configure event callback
  
});

// ============================================
// Sending Emails
// ============================================

/**
 * Send a simple welcome email.
 */
export const sendWelcomeEmail = mutation({
  args: {
    to: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const emailId = await usesend.sendEmail(ctx, {
      from: "Welcome <welcome@panabarbero.com>",
      to: args.to,
      subject: `Welcome to our app, ${args.name}!`,
      html: `<p>Hi ${args.name},</p><p>Welcome to our app! We're excited to have you.</p>`,
      text: `Hi ${args.name}, Welcome to our app! We're excited to have you.`,
    });

    console.log("Welcome email queued:", emailId);
    return emailId;
  },
});

/**
 * Send an email using a template.
 */
export const sendTemplateEmail = mutation({
  args: {
    to: v.string(),
    templateId: v.string(),
    variables: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const emailId = await usesend.sendEmail(ctx, {
      from: "Your App <notifications@yourdomain.com>",
      to: args.to,
      template: {
        id: args.templateId,
        variables: args.variables,
      },
    });

    return emailId;
  },
});

/**
 * Send an email with custom metadata for tracking.
 */
export const sendEmailWithMetadata = mutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    metadata: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const emailId = await usesend.sendEmail(ctx, {
      from: "Your App <noreply@yourdomain.com>",
      to: args.to,
      subject: args.subject,
      html: args.html,
      metadata: args.metadata,
    });

    return emailId;
  },
});

/**
 * Handle email events from useSend webhooks.
 *
 * This is called automatically when webhooks are received.
 */
export const handleEmailEvent = mutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    const { id, event } = args;

    console.log(`Email ${id} event: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case "email.delivered":
        console.log(`Email ${id} delivered to:`, event.data.to);
        // Update your database, trigger follow-up actions, etc.
        break;

      case "email.bounced":
        console.log(`Email ${id} bounced:`, event.data.bounce?.message);
        // Handle bounce - maybe mark email as invalid
        break;

      case "email.complained":
        console.log(`Email ${id} marked as spam`);
        // Handle complaint - unsubscribe user, etc.
        break;

      case "email.opened":
        console.log(`Email ${id} opened`);
        // Track open event
        break;

      case "email.clicked":
        console.log(`Email ${id} clicked:`, event.data.click?.url);
        // Track click event
        break;

      case "email.failed":
        console.log(`Email ${id} failed:`, event.data.failed?.reason);
        // Handle failure - retry or notify
        break;

      default:
        console.log(`Email ${id} event:`, event.type);
    }
  },
});

// ============================================
// Data Cleanup
// ============================================

/**
 * Cleanup old emails (run this periodically via cron job).
 */
export const cleanupOldEmails = mutation({
  args: {
    olderThan: v.optional(v.number()), // Milliseconds
  },
  handler: async (ctx, args) => {
    // Clean up finalized emails older than specified time
    await ctx.scheduler.runAfter(0, components.usesend.lib.cleanupOldEmails, {
      olderThan: args.olderThan ?? 7 * 24 * 60 * 60 * 1000, // 7 days default
    });

    // Clean up abandoned emails
    await ctx.scheduler.runAfter(
      0,
      components.usesend.lib.cleanupAbandonedEmails,
      {
        olderThan: 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    );
  },
});

// ============================================
// Helper Functions
// ============================================

async function getAuthUserId(ctx: { auth: Auth }) {
  return (await ctx.auth.getUserIdentity())?.subject ?? "anonymous";
}
