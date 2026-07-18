"use node";

import { sendReactEmail } from "@pulgueta/usesend-convex/react-email";
import { render } from "react-email";
import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { usesend } from "./example.js";
import WelcomeEmail from "./emails/welcome.js";

// Approach 1: react-email's render + usesend.sendEmail with html.
export const approachRender = internalAction({
  args: { to: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const html = await render(
      WelcomeEmail({ name: "Ada", verificationUrl: "https://x.dev" }),
    );
    return await usesend.sendEmail(ctx, {
      from: "Onboarding <x@acme.com>",
      to: args.to,
      subject: "Hey",
      html,
    });
  },
});

// Approach 2: sendReactEmail with a direct component call (no JSX, .ts file).
export const approachReact = internalAction({
  args: { to: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await sendReactEmail(usesend, ctx, {
      from: "Onboarding <x@acme.com>",
      to: args.to,
      subject: "Hey",
      react: WelcomeEmail({ name: "Ada", verificationUrl: "https://x.dev" }),
    });
  },
});
