import {
  actionGeneric,
  httpActionGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import type {
  Auth,
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
} from "convex/server";
import { v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
import type {
  EmailEvent,
  EmailStatus,
  EmailStatusResponse,
  SendEmailArgs,
  UseSendOptions,
} from "../component/types.js";

// Re-export types for developers
export type {
  EmailEvent,
  EmailStatus,
  EmailStatusResponse,
  SendEmailArgs,
  UseSendOptions,
};

/**
 * Branded type for Email IDs.
 */
export type EmailId = string & { __brand: "EmailId" };

/**
 * Validator for EmailId.
 */
export const vEmailId = v.string() as unknown as ReturnType<typeof v.string> & {
  __brand: "EmailId";
};

/**
 * Validator for email event callback args.
 */
export const vOnEmailEventArgs = v.object({
  id: vEmailId,
  event: v.any(), // EmailEvent validator
});

/**
 * useSend Convex Component Client
 *
 * This class provides a Resend-compatible API for sending emails via useSend.
 *
 * Example usage:
 * ```ts
 * import { components } from "./_generated/api";
 * import { UseSend } from "@pulgueta/usesend-convex";
 * import { internalMutation } from "./_generated/server";
 *
 * const usesend = new UseSend(components.usesend, {
 *   // Optional: override API key (defaults to USESEND_API_KEY env var)
 *   apiKey: "us_your_api_key",
 *
 *   // Optional: webhook secret for verifying webhooks
 *   webhookSecret: process.env.USESEND_WEBHOOK_SECRET,
 *
 *   // Optional: useSend base URL (defaults to https://app.usesend.com)
 *   baseUrl: "https://self-hosted-usesend.com",
 *
 *   // Optional: callback for email events
 *   onEmailEvent: internal.yourModule.handleEmailEvent,
 * });
 *
 * export const sendWelcomeEmail = internalMutation({
 *   handler: async (ctx) => {
 *     const emailId = await usesend.sendEmail(ctx, {
 *       from: "welcome@yourdomain.com",
 *       to: "user@example.com",
 *       subject: "Welcome!",
 *       html: "<p>Welcome to our app!</p>",
 *     });
 *     return emailId;
 *   },
 * });
 * ```
 */
export class UseSend {
  private options: UseSendOptions;

  constructor(
    private component: ComponentApi,
    options: Partial<UseSendOptions> & {
      onEmailEvent?: { fnHandle: string };
    } = {},
  ) {
    this.options = {
      apiKey: options.apiKey ?? getApiKeyFromEnv(),
      webhookSecret: options.webhookSecret ?? getWebhookSecretFromEnv(),
      baseUrl: options.baseUrl ?? "https://app.usesend.com",
      retryAttempts: options.retryAttempts ?? 3,
      initialBackoffMs: options.initialBackoffMs ?? 1000,
      ...options,
    };

    if (!this.options.apiKey) {
      throw new Error(
        "useSend API key is required. Set USESEND_API_KEY environment variable or pass apiKey option.",
      );
    }
  }

  /**
   * Send an email.
   *
   * @param ctx - Convex mutation context
   * @param args - Email arguments
   * @returns EmailId that can be used to check status or cancel
   *
   * Example:
   * ```ts
   * const emailId = await usesend.sendEmail(ctx, {
   *   from: "sender@yourdomain.com",
   *   to: "recipient@example.com",
   *   subject: "Hello",
   *   html: "<p>Hello!</p>",
   *   text: "Hello!",
   * });
   * ```
   */
  async sendEmail(ctx: MutationCtx, args: SendEmailArgs): Promise<EmailId> {
    // Normalize to/from arrays
    const to = Array.isArray(args.to) ? args.to : [args.to];
    const cc = args.cc
      ? Array.isArray(args.cc)
        ? args.cc
        : [args.cc]
      : undefined;
    const bcc = args.bcc
      ? Array.isArray(args.bcc)
        ? args.bcc
        : [args.bcc]
      : undefined;
    const replyTo = args.replyTo
      ? Array.isArray(args.replyTo)
        ? args.replyTo
        : [args.replyTo]
      : undefined;

    // Convert headers object to array format
    const headers = args.headers
      ? Object.entries(args.headers).map(([name, value]) => ({
          name,
          value: String(value),
        }))
      : undefined;

    return (await ctx.runMutation(this.component.lib.sendEmail, {
      options: this.options,
      from: args.from,
      to,
      cc,
      bcc,
      subject: args.subject,
      html: args.html,
      text: args.text,
      template: args.template,
      replyTo,
      headers,
      metadata: args.metadata,
    })) as EmailId;
  }

  /**
   * Check the status of an email.
   *
   * @param ctx - Convex query context
   * @param emailId - Email ID returned from sendEmail
   * @returns Current status or null if not found
   *
   * Example:
   * ```ts
   * const status = await usesend.status(ctx, emailId);
   * if (status) {
   *   console.log(status.status); // "delivered", "bounced", etc.
   *   console.log(status.opened);  // boolean
   *   console.log(status.clicked); // boolean
   * }
   * ```
   */
  async status(
    ctx: QueryCtx,
    emailId: EmailId,
  ): Promise<EmailStatusResponse | null> {
    return await ctx.runQuery(this.component.lib.getStatus, {
      emailId,
    });
  }

  /**
   * Get full email details.
   *
   * @param ctx - Convex query context
   * @param emailId - Email ID
   * @returns Email details or null if not found
   */
  async getEmail(ctx: QueryCtx, emailId: EmailId): Promise<any | null> {
    return await ctx.runQuery(this.component.lib.get, {
      emailId,
    });
  }

  /**
   * Cancel an email that hasn't been sent yet.
   *
   * @param ctx - Convex mutation context
   * @param emailId - Email ID
   * @throws Error if email not found or already sent
   *
   * Example:
   * ```ts
   * await usesend.cancelEmail(ctx, emailId);
   * ```
   */
  async cancelEmail(ctx: MutationCtx, emailId: EmailId): Promise<void> {
    await ctx.runMutation(this.component.lib.cancelEmail, {
      emailId,
    });
  }

  /**
   * Handle incoming webhook from useSend.
   *
   * Use this in your app's convex/http.ts:
   * ```ts
   * import { httpRouter } from "convex/server";
   * import { httpAction } from "./_generated/server";
   * import { usesend } from "./usesendSetup";
   *
   * const http = httpRouter();
   *
   * http.route({
   *   path: "/usesend-webhook",
   *   method: "POST",
   *   handler: httpAction(async (ctx, req) => {
   *     return await usesend.handleWebhook(ctx, req);
   *   }),
   * });
   *
   * export default http;
   * ```
   *
   * @param ctx - Convex action context
   * @param request - HTTP request
   * @returns HTTP response
   */
  async handleWebhook(ctx: ActionCtx, request: Request): Promise<Response> {
    // Import here to avoid loading in non-Node environments
    const { handleWebhook } = await import("../component/webhooks.js");
    return handleWebhook(ctx, request, this.options);
  }
}

/**
 * Expose useSend API functions with authentication.
 *
 * This is useful for creating your own API endpoints that wrap useSend.
 *
 * Example:
 * ```ts
 * export const { sendEmail, getStatus, cancelEmail } = exposeApi(
 *   components.usesend,
 *   {
 *     auth: async (ctx, operation) => {
 *       // Return user ID if authorized
 *       const userId = await getCurrentUser(ctx);
 *       if (!userId) throw new Error("Unauthorized");
 *       return userId;
 *     },
 *   }
 * );
 * ```
 */
export function exposeApi(
  component: ComponentApi,
  options: {
    auth: (
      ctx: { auth: Auth },
      operation:
        | { type: "send"; from: string; to: string[] }
        | { type: "read"; emailId: string }
        | { type: "cancel"; emailId: string },
    ) => Promise<string>;
    apiKey?: string;
    webhookSecret?: string;
    baseUrl?: string;
  },
) {
  const usesendOptions: UseSendOptions = {
    apiKey: options.apiKey ?? getApiKeyFromEnv(),
    webhookSecret: options.webhookSecret ?? getWebhookSecretFromEnv(),
    baseUrl: options.baseUrl ?? "https://app.usesend.com",
    retryAttempts: 3,
    initialBackoffMs: 1000,
  };

  return {
    sendEmail: mutationGeneric({
      args: {
        from: v.string(),
        to: v.union(v.string(), v.array(v.string())),
        cc: v.optional(v.union(v.string(), v.array(v.string()))),
        bcc: v.optional(v.union(v.string(), v.array(v.string()))),
        subject: v.optional(v.string()),
        html: v.optional(v.string()),
        text: v.optional(v.string()),
        template: v.optional(
          v.object({
            id: v.string(),
            variables: v.optional(v.record(v.string(), v.any())),
          }),
        ),
        replyTo: v.optional(v.union(v.string(), v.array(v.string()))),
        headers: v.optional(v.record(v.string(), v.string())),
        metadata: v.optional(v.record(v.string(), v.any())),
      },
      handler: async (ctx, args) => {
        const to = Array.isArray(args.to) ? args.to : [args.to];
        const cc = args.cc
          ? Array.isArray(args.cc)
            ? args.cc
            : [args.cc]
          : undefined;
        const bcc = args.bcc
          ? Array.isArray(args.bcc)
            ? args.bcc
            : [args.bcc]
          : undefined;
        const replyTo = args.replyTo
          ? Array.isArray(args.replyTo)
            ? args.replyTo
            : [args.replyTo]
          : undefined;

        const headers = args.headers
          ? Object.entries(args.headers).map(([name, value]) => ({
              name,
              value: String(value),
            }))
          : undefined;

        await options.auth(ctx, { type: "send", from: args.from, to });

        return await ctx.runMutation(component.lib.sendEmail, {
          options: usesendOptions,
          from: args.from,
          to,
          cc,
          bcc,
          subject: args.subject,
          html: args.html,
          text: args.text,
          template: args.template,
          replyTo,
          headers,
          metadata: args.metadata,
        });
      },
    }),

    getStatus: queryGeneric({
      args: { emailId: vEmailId },
      handler: async (ctx, args) => {
        await options.auth(ctx, { type: "read", emailId: args.emailId });
        return await ctx.runQuery(component.lib.getStatus, {
          emailId: args.emailId,
        });
      },
    }),

    cancelEmail: mutationGeneric({
      args: { emailId: vEmailId },
      handler: async (ctx, args) => {
        await options.auth(ctx, { type: "cancel", emailId: args.emailId });
        return await ctx.runMutation(component.lib.cancelEmail, {
          emailId: args.emailId,
        });
      },
    }),
  };
}

/**
 * Register HTTP routes for useSend webhooks.
 *
 * Example:
 * ```ts
 * import { httpRouter } from "convex/server";
 * import { registerRoutes } from "@pulgueta/usesend-convex";
 * import { components } from "./_generated/api";
 *
 * const http = httpRouter();
 *
 * registerRoutes(http, components.usesend, {
 *   path: "/usesend-webhook",
 *   apiKey: "us_your_key",
 *   webhookSecret: "your_webhook_secret",
 * });
 *
 * export default http;
 * ```
 */
export function registerRoutes(
  http: HttpRouter,
  component: ComponentApi,
  options: {
    path?: string;
    apiKey?: string;
    webhookSecret?: string;
    baseUrl?: string;
  } = {},
) {
  const path = options.path ?? "/usesend-webhook";
  const usesendOptions: UseSendOptions = {
    apiKey: options.apiKey ?? getApiKeyFromEnv(),
    webhookSecret: options.webhookSecret ?? getWebhookSecretFromEnv(),
    baseUrl: options.baseUrl ?? "https://app.usesend.com",
    retryAttempts: 3,
    initialBackoffMs: 1000,
  };

  http.route({
    path,
    method: "POST",
    handler: httpActionGeneric(async (ctx, request) => {
      const { handleWebhook } = await import("../component/webhooks.js");
      return handleWebhook(ctx, request, usesendOptions);
    }),
  });
}

// Helper functions to get environment variables
function getApiKeyFromEnv(): string {
  return process.env.USESEND_API_KEY!;
}

function getWebhookSecretFromEnv(): string | undefined {
  return process.env.USESEND_WEBHOOK_SECRET;
}

// Type helpers
// type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runMutation" | "runQuery" | "runAction"
>;
