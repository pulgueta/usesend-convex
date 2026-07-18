import { defineApp } from "convex/server";
import { v } from "convex/values";
import usesend from "@pulgueta/usesend-convex/convex.config.js";

const app = defineApp({
  env: {
    USESEND_API_KEY: v.string(),
    USESEND_BASE_URL: v.optional(v.string()),
  },
});
// Bind every env var the component can use by reference to the app's
// deployment env vars so secrets stay in deployment secret storage.
app.use(usesend, {
  env: {
    USESEND_API_KEY: app.env.USESEND_API_KEY,
    // optionals
    USESEND_BASE_URL: app.env.USESEND_BASE_URL,
  },
});

export default app;
