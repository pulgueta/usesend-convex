import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { UseSendOptions } from "./types";

/**
 * Verify useSend webhook signature.
 *
 * useSend signs webhooks using HMAC-SHA256:
 * signature = HMAC-SHA256(secret, "${timestamp}.${rawBody}")
 *
 * @param secret - Webhook secret from useSend dashboard
 * @param rawBody - Raw request body as string
 * @param signature - Signature from X-UseSend-Signature header
 * @param timestamp - Timestamp from X-UseSend-Timestamp header
 * @returns boolean indicating if signature is valid
 */
function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string,
  timestamp: string,
): boolean {
  try {
    // Import crypto for Node.js environment
    const { createHmac, timingSafeEqual } = require("crypto");

    // Compute expected signature
    const expectedSignature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    // Compare signatures using timing-safe comparison
    const expected = Buffer.from(`v1=${expectedSignature}`, "utf8");
    const received = Buffer.from(signature, "utf8");

    if (expected.length !== received.length) {
      return false;
    }

    return timingSafeEqual(expected, received);
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Validate webhook timestamp to prevent replay attacks.
 * Rejects signatures older than 5 minutes.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns boolean indicating if timestamp is valid
 */
function isTimestampValid(timestamp: string): boolean {
  const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  const eventTime = parseInt(timestamp, 10);

  if (isNaN(eventTime)) {
    return false;
  }

  return now - eventTime < MAX_AGE_MS;
}

/**
 * HTTP action handler for useSend webhooks.
 *
 * Usage in your app's convex/http.ts:
 * ```ts
 * import { httpRouter } from "convex/server";
 * import { httpAction } from "./_generated/server";
 * import { usesend } from "./yourUsesendSetup";
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
 * @param ctx - Convex context
 * @param request - HTTP request
 * @param options - Component options including webhook secret
 * @returns HTTP response
 */
export async function handleWebhook(
  ctx: any,
  request: Request,
  options: UseSendOptions,
): Promise<Response> {
  try {
    // Get raw body
    const rawBody = await request.text();

    // Get headers
    const signature = request.headers.get("X-UseSend-Signature");
    const timestamp = request.headers.get("X-UseSend-Timestamp");
    const eventType = request.headers.get("X-UseSend-Event");
    const callId = request.headers.get("X-UseSend-Call");
    const isRetry = request.headers.get("X-UseSend-Retry") === "true";

    // Validate required headers
    if (!signature || !timestamp || !eventType) {
      console.warn("Missing required webhook headers", {
        signature: !!signature,
        timestamp: !!timestamp,
        eventType: !!eventType,
      });
      return new Response(
        JSON.stringify({ error: "Missing required headers" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Verify webhook secret is configured
    if (!options.webhookSecret) {
      console.error("Webhook secret not configured");
      return new Response(
        JSON.stringify({ error: "Webhook secret not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate timestamp (prevent replay attacks)
    if (!isTimestampValid(timestamp)) {
      console.warn("Webhook timestamp too old or invalid", { timestamp });
      return new Response(JSON.stringify({ error: "Invalid timestamp" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify signature
    if (
      !verifyWebhookSignature(
        options.webhookSecret,
        rawBody,
        signature,
        timestamp,
      )
    ) {
      console.warn("Invalid webhook signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse event payload
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (error) {
      console.warn("Invalid JSON in webhook body", error);
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Log webhook receipt (helpful for debugging)
    console.log(`Received useSend webhook: ${eventType}`, {
      callId,
      isRetry,
      eventId: event.id,
    });

    // Process the webhook event
    await ctx.runMutation(internal.lib.processWebhookEvent, {
      event,
    });

    // Return success response
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error handling webhook:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Create an HTTP action handler for useSend webhooks.
 *
 * This is a factory function that creates a handler with the given options.
 *
 * @param options - Component options
 * @returns HTTP action handler
 */
export function createWebhookHandler(options: UseSendOptions) {
  return httpAction(async (ctx, request) => {
    return handleWebhook(ctx, request, options);
  });
}
