/**
 * React Email integration for the useSend component.
 *
 * Author emails as React components (https://react.email) and let this module
 * render them into email-client-safe HTML plus a plain-text fallback before
 * handing them to the durable send pipeline.
 *
 * Rendering uses `react-dom/server`, so these helpers must run inside an
 * action. Use a `"use node"` action for maximum compatibility.
 */
import { render } from "react-email";
import type { ReactNode } from "react";
import type { RunMutationCtx } from "../component/shared.js";
import type { EmailId, UseSend } from "../client/index.js";

export type { RunMutationCtx } from "../component/shared.js";

export type RenderedEmail = {
  /** The email rendered as client-compatible HTML. */
  html: string;
  /**
   * A plain-text version of the same email, for clients that don't render
   * HTML and to improve deliverability.
   */
  text: string;
};

/**
 * Renders a React Email element into HTML and a plain-text fallback.
 *
 * @param element The React node to render, e.g. `<WelcomeEmail name="Ada" />`
 * or `WelcomeEmail({ name: "Ada" })`.
 * @returns {@link RenderedEmail} with both representations.
 */
export async function renderEmail(
  element: ReactNode | Promise<ReactNode>,
): Promise<RenderedEmail> {
  const node = await element;
  const [html, text] = await Promise.all([
    render(node),
    render(node, { plainText: true }),
  ]);
  const htmlContent = html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<!--.*?-->/gs, "")
    .trim();
  if (htmlContent === "" && text.trim() === "") {
    throw new Error("The provided React node rendered no content");
  }
  return { html, text };
}

export type SendReactEmailOptions = {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  /** The React node to render into the email's HTML and text bodies. */
  react: ReactNode | Promise<ReactNode>;
  replyTo?: string[];
  headers?: Record<string, string>;
  /** ISO 8601 timestamp to schedule delivery. */
  scheduledAt?: string;
  inReplyToId?: string;
};

/**
 * Renders a React Email element and enqueues it through the component's
 * durable send pipeline (batching, retries, status tracking).
 *
 * @param usesend The {@link UseSend} instance configured for your app.
 * @param ctx Any context that can run a mutation. Rendering requires an
 * action, so in practice this is an action context.
 * @param options The email fields plus the `react` element to render.
 * @returns The id of the email within the component.
 */
export async function sendReactEmail(
  usesend: UseSend,
  ctx: RunMutationCtx,
  options: SendReactEmailOptions,
): Promise<EmailId> {
  const { react, ...email } = options;
  const { html, text } = await renderEmail(react);
  return usesend.sendEmail(ctx, { ...email, html, text });
}
