import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { usesend } from "./example.js";

const http = httpRouter();

// Handle useSend webhook events
// Set this URL in your useSend dashboard: https://your-convex-project.convex.site/usesend/webhook
http.route({
	path: "/usesend/webhook",
	method: "POST",
	handler: httpAction(async (ctx, req) => {
		return await usesend.handleUseSendEventWebhook(ctx, req);
	}),
});

export default http;
