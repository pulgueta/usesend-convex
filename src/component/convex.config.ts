import { defineComponent } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("usesend", {
  env: {
    // The useSend API key used by the durable batch sender. Declared as a
    // component environment variable so the credential stays in deployment
    // secret storage and is resolved at execution time — it is never
    // persisted in component documents. Bind it from the app:
    //   app.use(usesend, { env: { USESEND_API_KEY: app.env.USESEND_API_KEY } })
    USESEND_API_KEY: v.string(),
  },
});
component.use(rateLimiter);
component.use(workpool, { name: "emailWorkpool" });
component.use(workpool, { name: "callbackWorkpool" });

export default component;
