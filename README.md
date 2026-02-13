# useSend Convex Component

A Convex component for integrating the [useSend](https://usesend.com) email
service - the open-source alternative to Resend.

## Features

- **Email Sending**: Send emails via useSend's API with automatic batching and
  rate limiting
- **Webhook Handling**: Receive and verify useSend webhooks for delivery
  tracking
- **Status Tracking**: Track email delivery, opens, clicks, bounces, and
  complaints
- **Durable Execution**: Uses Convex workpools for reliable email delivery
- **Resend-Compatible API**: Easy migration from Resend
- **TypeScript**: Full type safety

## Installation

```bash
npm install @pulgueta/usesend-convex
```

## Setup

### 1. Configure Component

Add to your `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import usesend from "@pulgueta/usesend-convex/convex.config.js";

const app = defineApp();
app.use(usesend);

export default app;
```

### 2. Set Environment Variables

```bash
USESEND_API_KEY=us_your_api_key
USESEND_WEBHOOK_SECRET=whsec_your_webhook_secret
```

Get your API key and webhook secret from the
[useSend dashboard](https://app.usesend.com/dev-settings/api-keys).

### 3. Setup Webhook Endpoint

Create `convex/http.ts`:

```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { UseSend } from "@pulgueta/usesend-convex";
import { components } from "./_generated/api";

const http = httpRouter();

const usesend = new UseSend(components.usesend);

http.route({
  path: "/usesend-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await usesend.handleWebhook(ctx, req);
  }),
});

export default http;
```

If your Convex project is `happy-leopard-123`, your webhook URL is:

```
https://happy-leopard-123.convex.site/usesend-webhook
```

Configure this URL in your
[useSend dashboard](https://app.usesend.com/webhooks).

## Usage

### Sending Emails

```typescript
import { components } from "./_generated/api";
import { UseSend } from "@pulgueta/usesend-convex";
import { internalMutation } from "./_generated/server";

const usesend = new UseSend(components.usesend);

export const sendWelcomeEmail = internalMutation({
  handler: async (ctx) => {
    const emailId = await usesend.sendEmail(ctx, {
      from: "Welcome <welcome@yourdomain.com>",
      to: "user@example.com",
      subject: "Welcome!",
      html: "<p>Welcome to our app!</p>",
      text: "Welcome to our app!",
    });

    console.log("Email queued:", emailId);
    return emailId;
  },
});
```

### Sending with Templates

```typescript
await usesend.sendEmail(ctx, {
  from: "Your App <notifications@yourdomain.com>",
  to: "user@example.com",
  template: {
    id: "your-template-id",
    variables: {
      name: "John Doe",
      link: "https://yourapp.com/verify",
    },
  },
});
```

### Checking Email Status

```typescript
const status = await usesend.status(ctx, emailId);

if (status) {
  console.log(status.status); // "delivered", "bounced", "sent", etc.
  console.log(status.bounced); // boolean
  console.log(status.failed); // boolean
  console.log(status.complained); // boolean
  console.log(status.opened); // boolean
  console.log(status.clicked); // boolean
  console.log(status.errorMessage); // error details
}
```

### Cancelling Emails

```typescript
await usesend.cancelEmail(ctx, emailId);
```

Only emails with status "waiting" or "queued" can be cancelled.

### Handling Webhook Events

Register an event handler to receive notifications:

```typescript
import { UseSend, vOnEmailEventArgs } from "@pulgueta/usesend-convex";

const usesend = new UseSend(components.usesend, {
  onEmailEvent: internal.example.handleEmailEvent,
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, { id, event }) => {
    switch (event.type) {
      case "email.delivered":
        console.log("Delivered:", event.data.to);
        break;
      case "email.bounced":
        console.log("Bounced:", event.data.bounce?.message);
        break;
      case "email.opened":
        console.log("Opened!");
        break;
      case "email.clicked":
        console.log("Clicked:", event.data.click?.url);
        break;
    }
  },
});
```

## Configuration Options

```typescript
const usesend = new UseSend(components.usesend, {
  // API key (defaults to USESEND_API_KEY env var)
  apiKey: "us_your_api_key",

  // Webhook secret (defaults to USESEND_WEBHOOK_SECRET env var)
  webhookSecret: "whsec_your_secret",

  // useSend base URL (for self-hosted instances)
  baseUrl: "https://app.usesend.com",

  // Retry configuration
  retryAttempts: 3,
  initialBackoffMs: 1000,

  // Event callback
  onEmailEvent: internal.yourModule.handleEmailEvent,
});
```

## Supported Email Events

The component handles all useSend email events:

- `email.queued` - Email queued for sending
- `email.sent` - Email sent to recipient's mail server
- `email.delivered` - Email successfully delivered
- `email.delivery_delayed` - Delivery is being retried
- `email.bounced` - Email bounced
- `email.rejected` - Email rejected
- `email.complained` - Recipient marked as spam
- `email.failed` - Email failed to send
- `email.cancelled` - Scheduled email cancelled
- `email.suppressed` - Email suppressed
- `email.opened` - Recipient opened email
- `email.clicked` - Recipient clicked a link

## Data Cleanup

The component provides cleanup functions. Run them periodically via cron jobs:

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal, components } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "Cleanup old useSend data",
  { hours: 24 },
  internal.crons.cleanupUseSend,
);

export const cleanupUseSend = internalMutation({
  handler: async (ctx) => {
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    await ctx.scheduler.runAfter(0, components.usesend.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });

    await ctx.scheduler.runAfter(
      0,
      components.usesend.lib.cleanupAbandonedEmails,
      {
        olderThan: 4 * ONE_WEEK_MS,
      },
    );

    await ctx.scheduler.runAfter(0, components.usesend.lib.cleanupOldEvents, {
      olderThan: ONE_WEEK_MS,
    });
  },
});

export default crons;
```

## React Hooks

```tsx
import { useEmailStatus } from "@pulgueta/usesend-convex/react";

function EmailStatus({ emailId }: { emailId: string }) {
  const { status, isLoading } = useEmailStatus(api.usesend.getStatus, emailId);

  if (isLoading) return <div>Loading...</div>;
  if (!status) return <div>Email not found</div>;

  return (
    <div>
      <p>Status: {status.status}</p>
      {status.delivered && <span>✓ Delivered</span>}
      {status.opened && <span>✓ Opened</span>}
    </div>
  );
}
```

## Migration from Resend

This component is designed to be compatible with the `@convex-dev/resend` API:

1. Replace `@convex-dev/resend` with `@pulgueta/usesend-convex`
2. Change environment variables from `RESEND_API_KEY` to `USESEND_API_KEY`
3. Update webhook URL in dashboard
4. Most code should work without changes

## API Reference

### UseSend Class

#### `sendEmail(ctx, args)`

Send an email.

**Args:**

- `from` (string) - Sender email address
- `to` (string | string[]) - Recipient(s)
- `cc` (optional) - CC recipients
- `bcc` (optional) - BCC recipients
- `subject` (optional) - Email subject
- `html` (optional) - HTML content
- `text` (optional) - Plain text content
- `template` (optional) - Template ID and variables
- `replyTo` (optional) - Reply-to address(es)
- `headers` (optional) - Custom headers
- `metadata` (optional) - Custom metadata for tracking

#### `status(ctx, emailId)`

Get email status.

#### `getEmail(ctx, emailId)`

Get full email details.

#### `cancelEmail(ctx, emailId)`

Cancel a pending email.

#### `handleWebhook(ctx, request)`

Handle incoming webhook request.

## License

Apache-2.0
