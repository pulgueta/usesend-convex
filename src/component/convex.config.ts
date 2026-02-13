import { defineComponent } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

/**
 * useSend Convex Component
 *
 * This component integrates the useSend email service with Convex.
 *
 * Features:
 * - Queueing: Send as many emails as you want, they'll all be delivered
 * - Batching: Efficiently batches emails for processing
 * - Durable execution: Uses workpools to ensure emails are delivered
 * - Rate limiting: Honors useSend API rate limits
 * - Webhook handling: Receives and processes useSend webhooks
 * - Status tracking: Track email delivery, opens, clicks, bounces
 *
 * Installation:
 * ```ts
 * // convex/convex.config.ts
 * import { defineApp } from "convex/server";
 * import usesend from "@pulgueta/usesend-convex/convex.config.js";
 *
 * const app = defineApp();
 * app.use(usesend);
 *
 * export default app;
 * ```
 */

const component= defineComponent("usesend");

component.use(rateLimiter);
component.use(workpool, { name: "emailWorkpool" });
component.use(workpool, { name: "callbackWorkpool" });

export default component;