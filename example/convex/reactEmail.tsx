"use node";

import { internalAction } from "./_generated/server.js";
import { sendReactEmail } from "@pulgueta/usesend-convex/react-email";
import { v } from "convex/values";
import { usesend } from "./example.js";
import WelcomeEmail from "./emails/welcome.js";

// Send an email authored with React Email (https://react.email).
// The component is rendered to email-client-safe HTML plus a plain-text
// fallback, then enqueued through the durable send pipeline.
export const sendWelcomeEmail = internalAction({
  args: {
    to: v.string(),
    name: v.string(),
    verificationUrl: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await sendReactEmail(usesend, ctx, {
      from: "Onboarding <onboarding@yourdomain.com>",
      to: args.to,
      subject: `Welcome, ${args.name}!`,
      react: (
        <WelcomeEmail name={args.name} verificationUrl={args.verificationUrl} />
      ),
    });
  },
});
