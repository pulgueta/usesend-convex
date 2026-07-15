# useSend Convex Component

[![npm version](https://badge.fury.io/js/@pulgueta%2Fusesend-convex.svg)](https://badge.fury.io/js/@pulgueta%2Fusesend-convex)

This component is the official way to integrate the
[useSend](https://usesend.com) email service with your Convex project. useSend
is an open-source alternative to Resend, Sendgrid, Mailgun, and Postmark.

Features:

- **Queueing**: Send as many emails as you want, as fast as you want - they'll
  all be delivered (eventually).
- **Batching**: Automatically batches large groups of emails and sends them to
  useSend's `/emails/batch` endpoint efficiently.
- **Durable execution**: Uses Convex workpools to ensure emails are eventually
  delivered, even in the face of temporary failures or network outages.
- **Idempotency**: Manages useSend idempotency keys to guarantee emails are
  delivered exactly once, preventing accidental spamming from retries.
- **Rate limiting**: Honors API rate limits established by useSend.
- **Webhook support**: Receive real-time email delivery status updates.
- **Full API coverage**: Contacts, contact books, domains, campaigns, and
  analytics are available through a typed REST client (`usesend.api`).
- **Self-hosted support**: Works with both useSend's hosted service and
  self-hosted instances.

See [example/convex/example.ts](./example/convex/example.ts) for a demo of how
to incorporate this component into your application.

## Installation

```bash
npm install @pulgueta/usesend-convex
```

## Get Started

Create a [useSend](https://usesend.com) account and grab an API key. Set it to
`USESEND_API_KEY` in your deployment environment.

Next, add the component to your Convex app via `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import usesend from "@pulgueta/usesend-convex/convex.config.js";

const app = defineApp();
app.use(usesend);

export default app;
```

Then you can use it in your Convex functions:

```ts
// convex/emails.ts
import { components } from "./_generated/api";
import { UseSend } from "@pulgueta/usesend-convex";
import { internalMutation } from "./_generated/server";

export const usesend = new UseSend(components.usesend);

export const sendTestEmail = internalMutation({
  handler: async (ctx) => {
    await usesend.sendEmail(ctx, {
      from: "Me <test@mydomain.com>",
      to: "recipient@example.com",
      subject: "Hi there",
      html: "This is a test email",
    });
  },
});
```

Then, calling `sendTestEmail` from anywhere in your app will send this test
email.

## Advanced Usage

### Setting up a useSend webhook

While the setup we have so far will reliably send emails, you don't have any
feedback on anything delivering, bouncing, or triggering spam complaints. For
that, we need to set up a webhook!

On the Convex side, we need to mount an HTTP endpoint to our project to route it
to the useSend component in `convex/http.ts`:

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { usesend } from "./emails";

const http = httpRouter();

http.route({
  path: "/usesend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await usesend.handleUseSendEventWebhook(ctx, req);
  }),
});

export default http;
```

If your Convex project is `happy-leopard-123`, you now have a useSend webhook
for your project running at
`https://happy-leopard-123.convex.site/usesend-webhook`.

Navigate to the useSend dashboard and create a new webhook at that URL. Make
sure to enable all the `email.*` events.

Finally, copy the webhook secret out of the useSend dashboard and set it to the
`USESEND_WEBHOOK_SECRET` environment variable in your Convex deployment.

### Registering an email status event handler

If you have your webhook established, you can also register an event handler to
get notifications when email statuses change.

```ts
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { vOnEmailEventArgs, UseSend } from "@pulgueta/usesend-convex";

export const usesend = new UseSend(components.usesend, {
  onEmailEvent: internal.emails.handleEmailEvent,
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    console.log(`Email ${args.id} received event:`, args.event.type);

    switch (args.event.type) {
      case "email.delivered":
        console.log("Email delivered!");
        break;
      case "email.bounced":
        console.log("Email bounced");
        break;
      case "email.complained":
        console.log("Email marked as spam");
        break;
    }
  },
});
```

### UseSend component options

There is a `UseSendOptions` argument to the component constructor to help
customize its behavior:

- `apiKey`: Provide the useSend API key instead of having it read from the
  environment variable.
- `baseUrl`: The base URL for the useSend API (defaults to
  `https://app.usesend.com`). Set this if you're using a self-hosted useSend
  instance.
- `webhookSecret`: Same thing, but for the webhook secret.
- `initialBackoffMs`: Initial backoff for retries (default: 30 seconds).
- `retryAttempts`: Number of retry attempts (default: 5).
- `requestTimeoutMs`: Maximum time to wait for a useSend API response (default:
  30 seconds).
- `onEmailEvent`: Your email event callback.

### Using useSend Templates

You can use [useSend templates](https://docs.usesend.com) to send emails with
pre-designed templates from your useSend dashboard:

```ts
await usesend.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "recipient@example.com",
  template: {
    id: "my-template-id",
    variables: {
      name: "John Doe",
      verificationLink: "https://example.com/verify?token=abc123",
    },
  },
});
```

> **Note**: You cannot use both `template` and `html`/`text` in the same email.

### Scheduling and threading emails

Pass `scheduledAt` (ISO 8601) to have useSend deliver the email at a later
time, or `inReplyToId` to thread it under a previously sent email:

```ts
await usesend.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "recipient@example.com",
  subject: "See you tomorrow",
  html: "<p>Reminder!</p>",
  scheduledAt: "2026-08-01T09:00:00Z",
});
```

Emails already handed off to useSend with a future `scheduledAt` can be
rescheduled or cancelled through the REST API (see below) using the email's
`usesendId`:

```ts
await usesend.api.emails.updateSchedule(usesendId, "2026-08-02T09:00:00Z");
await usesend.api.emails.cancel(usesendId);
```

### Tracking, getting status, and cancelling emails

The `sendEmail` method returns a branded type, `EmailId`. You can use this for:

- Reassociating the original email during status changes in your email event
  handler.
- Checking on the status any time using `usesend.status(ctx, emailId)`.
- Cancelling a `waiting` email using `usesend.cancelEmail(ctx, emailId)`. Once
  batching starts, useSend may already be processing it and local cancellation
  is no longer safe.

```ts
// Check email status
const emailStatus = await usesend.status(ctx, emailId);
if (emailStatus) {
  console.log(emailStatus.status); // e.g., "delivered", "bounced", "sent"
  console.log(emailStatus.bounced); // boolean
  console.log(emailStatus.failed); // boolean
  console.log(emailStatus.complained); // spam complaint (boolean)
  console.log(emailStatus.deliveryDelayed); // boolean
  console.log(emailStatus.opened); // if open tracking enabled (boolean)
  console.log(emailStatus.clicked); // if click tracking enabled (boolean)
  console.log(emailStatus.errorMessage); // error details (string | null)
}
```

### Contacts, domains, campaigns, and analytics

Everything the useSend REST API offers beyond durable email sending is
available through `usesend.api`, a typed client covering contacts, contact
books, domains, campaigns, analytics, and direct email operations. These
methods perform HTTP calls, so they must run inside an **action**:

```ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { usesend } from "./emails";

export const subscribe = action({
  args: { contactBookId: v.string(), email: v.string() },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const { contactId } = await usesend.api.contacts.create(
      args.contactBookId,
      { email: args.email, subscribed: true },
    );
    return contactId;
  },
});
```

The full surface:

- `usesend.api.emails` — `send`, `batch`, `get`, `list`, `updateSchedule`,
  `cancel`. Direct sends support attachments and scheduling, and accept an
  idempotency key: `usesend.api.emails.send(email, { idempotencyKey })`.
- `usesend.api.contacts` — `create`, `get`, `list`, `update`, `upsert`,
  `delete`, `bulkCreate`, `bulkDelete` (all scoped to a contact book).
- `usesend.api.contactBooks` — `create`, `get`, `list`, `update`, `delete`.
- `usesend.api.domains` — `create`, `get`, `list`, `verify`, `delete`.
- `usesend.api.campaigns` — `create`, `get`, `list`, `delete`, `schedule`,
  `pause`, `resume`.
- `usesend.api.analytics` — `emailTimeSeries`, `reputationMetrics`.

Failed requests throw a `UseSendApiError` carrying the HTTP `status` and
response `body`. Note that emails sent through `usesend.api.emails.send` are
not tracked by the component — use `sendEmail` (durable batching) or
`sendEmailManually` (tracked manual send, below) for that.

### Self-hosted useSend

If you're running a self-hosted useSend instance, configure the `baseUrl`:

```ts
export const usesend = new UseSend(components.usesend, {
  baseUrl: "https://your-usesend-instance.com",
});
```

### Data retention

This component retains "finalized" (delivered, cancelled, bounced) emails. It's
your responsibility to clear out those emails on your own schedule. You can run
`cleanupOldEmails` and `cleanupAbandonedEmails` from the dashboard or set up a
cron job:

```ts
// in convex/crons.ts
import { cronJobs } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const crons = cronJobs();
crons.interval(
  "Remove old emails from the usesend component",
  { hours: 1 },
  internal.crons.cleanupUseSend,
);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const cleanupUseSend = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.usesend.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      components.usesend.lib.cleanupAbandonedEmails,
      { olderThan: 4 * ONE_WEEK_MS },
    );
  },
});

export default crons;
```

### Using React Email

The component ships with a [React Email](https://react.email/) integration at
`@pulgueta/usesend-convex/react-email`. Author your emails as React
components; `sendReactEmail` renders them to email-client-safe HTML **plus a
plain-text fallback** (better accessibility and deliverability) and enqueues
them through the durable send pipeline.

Install React Email in your app to author templates:

```sh
npm install react-email react-dom -E
```

Define a template (see [react.email/docs](https://react.email/docs) for the
client-compatibility rules — no flexbox/grid, pixel-based sizing, etc.):

```tsx
// convex/emails/welcome.tsx
import { Body, Button, Container, Head, Html, Preview, Text } from "react-email";

export default function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html lang="en">
      <Head />
      <Body style={{ fontFamily: "sans-serif" }}>
        <Preview>Welcome aboard!</Preview>
        <Container>
          <Text>{`Welcome, ${name}!`}</Text>
          <Button
            href="https://example.com"
            style={{ background: "#000", color: "#fff", padding: "12px 20px" }}
          >
            Get started
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
```

Then render and send it from an action (use a Node action for maximum
compatibility with `react-dom/server`):

```tsx
// convex/reactEmail.tsx
"use node";
import { internalAction } from "./_generated/server";
import { sendReactEmail } from "@pulgueta/usesend-convex/react-email";
import { v } from "convex/values";
import { usesend } from "./emails";
import WelcomeEmail from "./emails/welcome";

export const sendWelcomeEmail = internalAction({
  args: { to: v.string(), name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await sendReactEmail(usesend, ctx, {
      from: "Onboarding <onboarding@mydomain.com>",
      to: args.to,
      subject: `Welcome, ${args.name}!`,
      react: <WelcomeEmail name={args.name} />,
    });
  },
});
```

If you only want the rendered output (e.g. to pass to
`usesend.api.emails.send` with attachments), use `renderEmail`:

```tsx
import { renderEmail } from "@pulgueta/usesend-convex/react-email";

const { html, text } = await renderEmail(<WelcomeEmail name="Ada" />);
```

See [example/convex/emails/welcome.tsx](./example/convex/emails/welcome.tsx)
for a fuller template using Tailwind with `pixelBasedPreset`.

### Sending emails manually

If you want to bypass the component's batching (e.g. to attach files) while
still tracking the email's delivery status through webhooks, use
`sendEmailManually`. It records the email in the component, you perform the
actual send in the callback (here via `usesend.api`), and the returned
useSend ID links webhook events back to the record:

```ts
export const sendManualEmail = internalAction({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const from = "Acme <onboarding@example.com>";
    const to = ["recipient@example.com"];
    const subject = "hello world";

    const emailId = await usesend.sendEmailManually(
      ctx,
      { from, to, subject },
      async () => {
        const result = await usesend.api.emails.send({
          from,
          to,
          subject,
          html: "<p>it works!</p>",
          attachments: [{ filename: "invoice.pdf", content: base64Pdf }],
        });
        return result.emailId;
      },
    );
    return emailId;
  },
});
```

## Development

To develop this component:

```sh
pnpm install
pnpm dev
```

This will start a file watcher to rebuild the component, as well as the example
project frontend and backend.

## License

Apache-2.0
