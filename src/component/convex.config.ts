import { defineComponent } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

// All environment variables the component can use are declared here and bound
// by the app when installing it:
//   app.use(usesend, {
//     env: {
//       USESEND_API_KEY: app.env.USESEND_API_KEY,
//       // optionals
//       USESEND_BASE_URL: app.env.USESEND_BASE_URL,
//     },
//   });
const component = defineComponent("usesend", {
  env: {
    // The useSend API key used by the durable batch sender. Declared as a
    // component environment variable so the credential stays in deployment
    // secret storage and is resolved at execution time — it is never
    // persisted in component documents.
    USESEND_API_KEY: v.string(),
    // Optional override for the useSend API base URL (self-hosted
    // instances). When bound and set, it takes precedence over the
    // client-provided baseUrl for durable batch sends; when unset, the
    // per-instance baseUrl (default https://app.usesend.com) is used.
    USESEND_BASE_URL: v.optional(v.string()),
  },
});
component.use(rateLimiter);
component.use(workpool, { name: "emailWorkpool" });
component.use(workpool, { name: "callbackWorkpool" });

export default component;
