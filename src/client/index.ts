import {
  createFunctionHandle,
  internalMutationGeneric,
  type FunctionReference,
  type FunctionVisibility,
  type GenericDataModel,
  type GenericMutationCtx,
} from "convex/server";
import { v } from "convex/values";
import type { VString } from "convex/values";
import {
  vEmailEvent,
  type EmailEvent,
  type RunMutationCtx,
  type RunQueryCtx,
  type RuntimeConfig,
  type Status,
  type Template,
} from "../component/shared.js";
import type { ComponentApi } from "../component/_generated/component.js";
import { UseSendApi } from "./api.js";

export * from "./api.js";

export type UseSendComponent = ComponentApi;

export type EmailId = string & { __isEmailId: true };
export const vEmailId = v.string() as VString<EmailId>;
export {
  vEmailEvent,
  vOptions,
  vStatus,
  vTemplate,
} from "../component/shared.js";
export type { EmailEvent, Status, Template } from "../component/shared.js";
export const vOnEmailEventArgs = v.object({
  id: vEmailId,
  event: vEmailEvent,
});

type Config = RuntimeConfig & {
  webhookSecret: string;
};

function getDefaultConfig(): Config {
  return {
    apiKey: process.env.USESEND_API_KEY ?? "",
    baseUrl: process.env.USESEND_BASE_URL ?? "https://app.usesend.com",
    webhookSecret: process.env.USESEND_WEBHOOK_SECRET ?? "",
    initialBackoffMs: 30000,
    retryAttempts: 5,
  };
}

export type UseSendOptions = {
  /**
   * The API key to use for the useSend API.
   * If not provided, the API key will be read from the environment variable USESEND_API_KEY.
   */
  apiKey?: string;

  /**
   * The base URL for the useSend API.
   * If not provided, defaults to https://app.usesend.com.
   * Set this if you're using a self-hosted useSend instance.
   */
  baseUrl?: string;

  /**
   * The secret to use for the useSend webhook.
   * If not provided, the webhook secret will be read from the environment variable USESEND_WEBHOOK_SECRET.
   */
  webhookSecret?: string;

  /**
   * The initial backoff to use for the useSend API.
   * If not provided, the initial backoff will be 30 seconds.
   */
  initialBackoffMs?: number;

  /**
   * The number of retry attempts to use for the useSend API.
   * If not provided, the number of retry attempts will be 5.
   */
  retryAttempts?: number;

  /**
   * A mutation to run after an email event occurs.
   * The mutation will be passed the email id and the event.
   */
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
};

async function configToRuntimeConfig(
  config: Config,
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null,
): Promise<RuntimeConfig> {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    initialBackoffMs: config.initialBackoffMs,
    retryAttempts: config.retryAttempts,
    onEmailEvent: onEmailEvent
      ? { fnHandle: await createFunctionHandle(onEmailEvent) }
      : undefined,
  };
}

export type EmailStatus = {
  /**
   * The status of the email. It will be one of the following:
   * - `waiting`: The email has not yet been batched.
   * - `queued`: The email has been batched and is waiting to be sent.
   * - `cancelled`: The email has been cancelled.
   * - `sent`: The email has been sent to useSend, but we do not yet know its fate.
   * - `bounced`: The email bounced.
   * - `delivered`: The email was delivered successfully.
   * - `delivery_delayed`: useSend is having trouble delivering the email, but is still trying.
   */
  status: Status;

  /**
   * The error message of the email. Typically only set on bounces.
   */
  errorMessage: string | null;

  /**
   * Whether the email bounced.
   */
  bounced: boolean;

  /**
   * Whether the email was marked as spam. This is only set on emails which are delivered.
   */
  complained: boolean;

  /**
   * Whether the email failed to send.
   */
  failed: boolean;

  /**
   * Whether the email delivery was delayed.
   */
  deliveryDelayed: boolean;

  /**
   * If you're using open tracking, did useSend detect that the email was opened?
   */
  opened: boolean;

  /**
   * If you're using click tracking, did useSend detect that a link was clicked?
   */
  clicked: boolean;
};

export type SendEmailOptions =
  | {
      from: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      subject: string;
      html?: string;
      text?: string;
      replyTo?: string[];
      headers?: Record<string, string>;
      /** ISO 8601 timestamp to schedule delivery. */
      scheduledAt?: string;
      inReplyToId?: string;
    }
  | {
      from: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      subject?: string;
      template: {
        id: string;
        variables?: Record<string, string | number>;
      };
      html?: never;
      text?: never;
      replyTo?: string[];
      headers?: Record<string, string>;
      /** ISO 8601 timestamp to schedule delivery. */
      scheduledAt?: string;
      inReplyToId?: string;
    };

/**
 * Computes HMAC-SHA256 using the Web Crypto API (available in Convex runtime).
 * Returns the hex-encoded signature.
 */
async function computeHmacSha256(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export class UseSend {
  public config: Config;
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
  private _api?: UseSendApi;

  /**
   * Creates a UseSend component.
   *
   * @param component The component to use, like `components.usesend` from
   * `./_generated/api.ts`.
   * @param options The {@link UseSendOptions} to use for this component.
   */
  constructor(
    public component: ComponentApi,
    options?: UseSendOptions,
  ) {
    const defaultConfig = getDefaultConfig();
    this.config = {
      apiKey: options?.apiKey ?? defaultConfig.apiKey,
      baseUrl: options?.baseUrl ?? defaultConfig.baseUrl,
      webhookSecret: options?.webhookSecret ?? defaultConfig.webhookSecret,
      initialBackoffMs:
        options?.initialBackoffMs ?? defaultConfig.initialBackoffMs,
      retryAttempts: options?.retryAttempts ?? defaultConfig.retryAttempts,
    };
    if (options?.onEmailEvent) {
      this.onEmailEvent = options.onEmailEvent;
    }
  }

  /**
   * Direct access to the full useSend REST API: contacts, contact books,
   * domains, campaigns, analytics, and email operations not covered by the
   * durable component pipeline (attachments, rescheduling, listing).
   *
   * These calls go straight to useSend, so they must run inside an action.
   * Emails sent this way are not tracked by the component; use
   * {@link sendEmailManually} if you want tracking.
   */
  get api(): UseSendApi {
    this._api ??= new UseSendApi({
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    });
    return this._api;
  }

  /**
   * Sends an email
   *
   * Specifically, enqueues your email to be sent as part of efficient, durable email batches
   * managed by the component. The email will be sent as soon as possible, but the component
   * will manage rate limiting and batching for efficiency.
   *
   * This component utilizes idempotency keys to ensure the email is sent exactly once.
   *
   * @param ctx Any context that can run a mutation. You can enqueue an email from
   * either a mutation or an action.
   * @param options The {@link SendEmailOptions} object containing all email parameters.
   * @returns The id of the email within the component.
   */
  async sendEmail(
    ctx: RunMutationCtx,
    options: SendEmailOptions,
  ): Promise<EmailId> {
    if (this.config.apiKey === "") throw new Error("API key is not set");

    const id = await ctx.runMutation(this.component.lib.sendEmail, {
      options: await configToRuntimeConfig(this.config, this.onEmailEvent),
      ...options,
      to: typeof options.to === "string" ? [options.to] : options.to,
      cc: toArray(options.cc),
      bcc: toArray(options.bcc),
    });

    return id as EmailId;
  }

  /**
   * Sends an email manually without batching.
   *
   * This is useful when you need features not supported by the batch API,
   * such as attachments, or when you want to send an email immediately.
   *
   * @param ctx Any context that can run a mutation.
   * @param options The email options (from, to, subject, etc.).
   * @param sendCallback A callback that performs the actual send and returns the useSend email ID.
   * @returns The id of the email within the component.
   */
  async sendEmailManually(
    ctx: RunMutationCtx,
    options: {
      from: string;
      to: string | string[];
      cc?: string | string[];
      bcc?: string | string[];
      subject: string;
      replyTo?: string[];
      headers?: Record<string, string>;
    },
    sendCallback: (emailId: EmailId) => Promise<string>,
  ): Promise<EmailId> {
    const emailId = (await ctx.runMutation(
      this.component.lib.createManualEmail,
      {
        from: options.from,
        to: options.to,
        subject: options.subject,
        replyTo: options.replyTo,
        headers: options.headers,
      },
    )) as EmailId;
    try {
      const usesendId = await sendCallback(emailId);
      await ctx.runMutation(this.component.lib.updateManualEmail, {
        emailId,
        status: "sent",
        usesendId,
      });
    } catch (error) {
      await ctx.runMutation(this.component.lib.updateManualEmail, {
        emailId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        usesendId:
          typeof error === "object" && error !== null && "usesendId" in error
            ? typeof error.usesendId === "string"
              ? error.usesendId
              : undefined
            : undefined,
      });
      throw error;
    }

    return emailId as EmailId;
  }

  /**
   * Cancels an email.
   *
   * This will mark the email as cancelled if it has not already been sent to useSend.
   *
   * @param ctx Any context that can run a mutation. You can cancel an email from
   * either a mutation or an action.
   * @param emailId The id of the email to cancel. This was returned from {@link sendEmail}.
   */
  async cancelEmail(ctx: RunMutationCtx, emailId: EmailId) {
    await ctx.runMutation(this.component.lib.cancelEmail, {
      emailId,
    });
  }

  /**
   * Gets the status of an email.
   *
   * @param ctx Any context that can run a query. You can get the status of an email from
   * an action, mutation, or query.
   * @param emailId The id of the email to get the status of. This was returned from {@link sendEmail}.
   * @returns {@link EmailStatus} The status of the email.
   */
  async status(
    ctx: RunQueryCtx,
    emailId: EmailId,
  ): Promise<EmailStatus | null> {
    return await ctx.runQuery(this.component.lib.getStatus, {
      emailId,
    });
  }

  /**
   * Gets a full email.
   *
   * @param ctx Any context that can run a query. You can get an email from
   * an action, mutation, or query.
   * @param emailId The id of the email to get. This was returned from {@link sendEmail}.
   * @returns The email, or null if the email does not exist.
   */
  async get(
    ctx: RunQueryCtx,
    emailId: EmailId,
  ): Promise<{
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    replyTo: string[];
    headers?: Record<string, string>;
    status: Status;
    errorMessage?: string;
    bounced?: boolean;
    complained: boolean;
    failed?: boolean;
    deliveryDelayed?: boolean;
    opened?: boolean;
    clicked?: boolean;
    usesendId?: string;
    finalizedAt: number;
    createdAt: number;
    html?: string;
    text?: string;
    template?: Template;
    scheduledAt?: string;
    inReplyToId?: string;
  } | null> {
    return await ctx.runQuery(this.component.lib.get, {
      emailId,
    });
  }

  /**
   * Handles a useSend event webhook.
   *
   * This will update emails in the component with the status of the email as detected by useSend,
   * and call your `onEmailEvent` mutation if it is set.
   *
   * @param ctx Any context that can run a mutation.
   * @param req The request to handle from useSend.
   * @returns A response to send back to useSend.
   */
  async handleUseSendEventWebhook(
    ctx: RunMutationCtx,
    req: Request,
  ): Promise<Response> {
    if (this.config.webhookSecret === "") {
      throw new Error("Webhook secret is not set");
    }

    const raw = await req.text();
    const signature = req.headers.get("X-UseSend-Signature") ?? "";
    const timestamp = req.headers.get("X-UseSend-Timestamp") ?? "";

    // Verify the webhook signature using Web Crypto API
    const isValid = await this.verifyWebhookSignature(
      raw,
      signature,
      timestamp,
    );
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(raw);
    const event: EmailEvent = payload as EmailEvent;

    await ctx.runMutation(this.component.lib.handleEmailEvent, {
      event,
    });

    return new Response(null, {
      status: 200,
    });
  }

  /**
   * Verifies a webhook signature from useSend using the Web Crypto API.
   *
   * The signature is computed as: HMAC-SHA256(secret, "${timestamp}.${rawBody}")
   * and compared against the X-UseSend-Signature header (format: "v1=${hex_signature}").
   *
   * @param rawBody The raw request body as a string.
   * @param signature The X-UseSend-Signature header value.
   * @param timestamp The X-UseSend-Timestamp header value.
   * @returns Whether the signature is valid.
   */
  private async verifyWebhookSignature(
    rawBody: string,
    signature: string,
    timestamp: string,
  ): Promise<boolean> {
    // Check timestamp is within 5 minutes to prevent replay attacks
    const timestampMs = parseInt(timestamp, 10);
    if (isNaN(timestampMs)) {
      return false;
    }
    const now = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;
    if (Math.abs(now - timestampMs) > fiveMinutesMs) {
      return false;
    }

    // Compute expected signature: HMAC-SHA256(secret, "${timestamp}.${rawBody}")
    const expectedSignatureHex = await computeHmacSha256(
      this.config.webhookSecret,
      `${timestamp}.${rawBody}`,
    );

    const expectedSignature = `v1=${expectedSignatureHex}`;

    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(expectedSignature, signature);
  }

  /**
   * Defines a mutation to run after an email event occurs.
   *
   * It is probably simpler to just define your mutation as an `internalMutation`
   * and pass the `vOnEmailEventArgs` as the args than use this.
   * See the example in the README for more.
   *
   * @param handler The handler to run after an email event occurs.
   * @returns The mutation to run after an email event occurs.
   */
  defineOnEmailEvent<DataModel extends GenericDataModel>(
    handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: { id: EmailId; event: EmailEvent },
    ) => Promise<void>,
  ) {
    return internalMutationGeneric({
      args: {
        id: vEmailId,
        event: vEmailEvent,
      },
      handler,
    });
  }
}

function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}
