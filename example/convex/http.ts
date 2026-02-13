import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { UseSend } from "@pulgueta/usesend-convex";
import { components } from "./_generated/api";

const http = httpRouter();

// Initialize the useSend component
const usesend = new UseSend(components.usesend, {
  // Optional: API key (defaults to USESEND_API_KEY env var)
  // apiKey: "us_your_api_key",
  // Optional: Webhook secret (defaults to USESEND_WEBHOOK_SECRET env var)
  // webhookSecret: "whsec_your_webhook_secret",
  // Optional: Base URL for self-hosted useSend
  // baseUrl: "https://app.usesend.com",
});

// Webhook endpoint for useSend
http.route({
  path: "/usesend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await usesend.handleWebhook(ctx, req);
  }),
});

export default http;
