import { defineApp } from "convex/server";
import { v } from "convex/values";
import usesend from "@pulgueta/usesend-convex/convex.config.js";

const app = defineApp({
  env: {
    USESEND_API_KEY: v.string(),
  },
});
// Bind the component's USESEND_API_KEY env var by reference to the app's
// deployment env var so the secret stays in deployment secret storage.
app.use(usesend, {
  env: { USESEND_API_KEY: app.env.USESEND_API_KEY },
});

export default app;
