import { defineApp } from "convex/server";
import usesend from "@pulgueta/usesend-convex/convex.config.js";

const app = defineApp();
app.use(usesend);

export default app;
