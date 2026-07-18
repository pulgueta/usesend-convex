import { defineComponent } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("usesend", {
  env: {
    USESEND_API_KEY: v.string(),
    USESEND_BASE_URL: v.optional(v.string()),
  },
});
component.use(rateLimiter);
component.use(workpool, { name: "emailWorkpool" });
component.use(workpool, { name: "callbackWorkpool" });

export default component;
